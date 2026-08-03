import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

async function getGoogleSheetsInstance() {
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

  // 1. Очищаем от внешних кавычек
  privateKey = privateKey.trim().replace(/^["']|["']$/g, '');

  // 2. Превращаем все варианты символов \n в настоящие переносы строк
  privateKey = privateKey.replace(/\\n/g, '\n');

  // 3. Страховка: если ключ все еще в одну строчку без переносов, форматируем PEM вручную
  if (!privateKey.includes('\n') && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    privateKey = privateKey
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
  }

  const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL)?.trim();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();

  if (!clientEmail || !privateKey || !spreadsheetId) {
    console.error('Google Sheets env variables missing in dance-app', {
      hasEmail: !!clientEmail,
      hasKey: !!privateKey,
      hasSheetId: !!spreadsheetId
    });
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, spreadsheetId };
}

// Функция генерации заметок через Grok (xAI)
async function generateGrokNote(parentName: string, childName: string, childAge: string, city: string): Promise<string> {
  const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  
  if (!apiKey) {
    return 'Заявка с веб-сайта';
  }

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [
          {
            role: 'system',
            content: 'Ты администратор детской танцевальной студии. Напиши очень короткую заметку для менеджера по новой заявке (1 предложение на русском языке): оцени возраст ребенка для занятий и дай рекомендацию по звонку.'
          },
          {
            role: 'user',
            content: `Родитель: ${parentName}, Ребенок: ${childName}, Возраст: ${childAge || 'не указан'}, Город: ${city}`
          }
        ],
        max_tokens: 50,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error('Grok API error response:', await response.text());
      return 'Заявка с веб-сайта';
    }

    const data = await response.json();
    const note = data.choices?.[0]?.message?.content?.trim();
    return note || 'Заявка с веб-сайта';
  } catch (err) {
    console.error('Error connecting to Grok API:', err);
    return 'Заявка с веб-сайта';
  }
}

export async function POST(req: NextRequest) {
  try {
    const { parent_name, child_name, phone, city } = await req.json();

    if (!parent_name || !phone) {
      return NextResponse.json(
        { status: 'error', message: 'Имя и телефон обязательны' },
        { status: 400 }
      );
    }

    const instance = await getGoogleSheetsInstance();
    if (!instance) {
      return NextResponse.json(
        { status: 'error', message: 'Ошибка конфигурации сервера' },
        { status: 500 }
      );
    }

    const { sheets, spreadsheetId } = instance;

    // Генерируем уникальный ID заявки (например: LD-5839)
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const leadId = `LD-${randomNum}`;

    // Точный парсинг имени и чистого числа возраста
    const rawChildInput = (child_name || '').trim();
    let parsedChildName = rawChildInput;
    let parsedChildAge = '';

    if (rawChildInput) {
      // 1. Находим первую цифру в строке — это наш возраст
      const ageMatch = rawChildInput.match(/\d+/);
      if (ageMatch) {
        parsedChildAge = ageMatch[0]; // Извлекает строго цифры (например "4")
      }

      // 2. Имя очищаем от цифр и лишних знаков
      const nameMatch = rawChildInput.split(/\d+/)[0];
      parsedChildName = nameMatch.replace(/[,\-–—]/g, '').trim();

      if (!parsedChildName) {
        parsedChildName = rawChildInput;
      }
    }

    const leadCity = city || 'Серпухов';

    // Генерируем заметку с помощью Grok
    const aiNote = await generateGrokNote(parent_name, parsedChildName, parsedChildAge, leadCity);

    // Форматируем дату создания в формате YYYY-MM-DD
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    // Формируем порядок колонок от A до K:
    const newRow = [
      leadId,             // A: ID Заявки (lead_id)
      parent_name,        // B: ФИО Родителя (parent_name)
      parsedChildName,    // C: Имя ребенка (child_name)
      parsedChildAge,     // D: Возраст ребенка (только число, например '4')
      phone,              // E: Телефон (phone)
      leadCity,           // F: Город (city)
      '-',                // G: Telegram Никнейм (tg_username)
      'Новая',            // H: Статус заявки (status)
      '-',                // I: Дата 1-го занятия (first_lesson_date)
      aiNote,             // J: Заметки ИИ (от Grok)
      dateStr             // K: Дата создания (created_at) -> YYYY-MM-DD
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'leads!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    const botUsername = process.env.NEXT_PUBLIC_TG_BOT_USERNAME || 'BabyDanceBot';
    const tg_url = `https://t.me/${botUsername}?start=${leadId}`;

    return NextResponse.json({
      status: 'success',
      tg_url: tg_url
    });

  } catch (error: any) {
    console.error('Error in lead API:', error);
    return NextResponse.json(
      { status: 'error', message: error.message || 'Ошибка сервера' },
      { status: 500 }
    );
  }
}