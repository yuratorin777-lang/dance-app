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
      hasSheetId: !!spreadsheetId,
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

// Функция генерации заметок через Grok (xAI) с защитным таймаутом
async function generateGrokNote(parentName: string, childName: string, childAge: string, city: string): Promise<string> {
  const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  
  if (!apiKey) {
    return 'Заявка с веб-сайта';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 сек таймаут, чтобы не вешать Vercel

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
        messages: [
          {
            role: 'system',
            content: 'Ты администратор детской танцевальной студии. Напиши очень короткую заметку для менеджера по новой заявке (1 предложение на русском языке): оцени возраст ребенка для занятий и дай рекомендацию по звонку.',
          },
          {
            role: 'user',
            content: `Родитель: ${parentName}, Ребенок: ${childName}, Возраст: ${childAge || 'не указан'}, Город: ${city}`,
          },
        ],
        max_tokens: 60,
        temperature: 0.7,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('Grok API error response:', await response.text());
      return 'Заявка с веб-сайта';
    }

    const data = await response.json();
    const note = data.choices?.[0]?.message?.content?.trim();
    return note || 'Заявка с веб-сайта';
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error or timeout connecting to Grok API:', err);
    return 'Заявка с веб-сайта';
  }
}

// Функция отправки карточки заявки в закрытую группу Telegram
async function sendTelegramAdminNotification({
  leadId,
  parentName,
  childName,
  childAge,
  phone,
  city,
  aiNote,
}: {
  leadId: string;
  parentName: string;
  childName: string;
  childAge: string;
  phone: string;
  city: string;
  aiNote: string;
}): Promise<number | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const rawTopicId = process.env.TELEGRAM_LEADS_TOPIC_ID || '1';

  if (!botToken || !chatId) {
    console.warn('Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID missing.');
    return null;
  }

  const ageText = childAge ? `${childAge} лет` : 'не указан';
  const childInfo = childName ? `${childName} (${ageText})` : 'не указан';

  const messageText = `
🔥 <b>НОВАЯ ЗАЯВКА С САЙТА!</b>

🆔 <b>ID Заявки:</b> <code>${leadId}</code>
👤 <b>Родитель:</b> ${parentName}
👶 <b>Ребенок:</b> ${childInfo}
📞 <b>Телефон:</b> <code>${phone}</code>
📍 <b>Город:</b> ${city}

🧠 <b>Заметка ИИ (Grok):</b>
<i>${aiNote}</i>
`.trim();

  const payload: Record<string, any> = {
    chat_id: chatId,
    text: messageText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📅 Записать на пробное',
            callback_data: `assign_lesson:${leadId}`,
          },
        ],
      ],
    },
  };

  if (rawTopicId && !isNaN(Number(rawTopicId))) {
    payload.message_thread_id = Number(rawTopicId);
  }

  try {
    let response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Страховка: если с темой возникла ошибка 400 (например, неверный ID), слать в общий чат
    if (!response.ok && payload.message_thread_id) {
      console.warn('Failed to send to topic, fallback to main chat...');
      delete payload.message_thread_id;

      response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (response.ok) {
      const responseData = await response.json();
      return responseData.result?.message_id || null;
    } else {
      const errorData = await response.text();
      console.error('Failed to send Telegram message:', errorData);
      return null;
    }
  } catch (err) {
    console.error('Error sending Telegram admin notification:', err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Поддерживаем ключи как в snake_case, так и в camelCase
    const parent_name = body.parent_name || body.parentName || '';
    const child_name = body.child_name || body.childName || '';
    const phone = body.phone || '';
    const city = body.city || '';

    if (!parent_name || !phone) {
      return NextResponse.json(
        { status: 'error', message: 'Имя и телефон обязательны' },
        { status: 400 }
      );
    }

    const instance = await getGoogleSheetsInstance();
    if (!instance) {
      return NextResponse.json(
        { status: 'error', message: 'Ошибка конфигурации сервера Google Sheets' },
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
      const ageMatch = rawChildInput.match(/\d+/);
      if (ageMatch) {
        parsedChildAge = ageMatch[0]; // Извлекает строго цифры
      }

      const nameMatch = rawChildInput.split(/\d+/)[0];
      parsedChildName = nameMatch.replace(/[,\-–—]/g, '').trim();

      if (!parsedChildName) {
        parsedChildName = rawChildInput;
      }
    }

    const leadCity = city || 'Серпухов';

    // Генерируем заметку с помощью Grok
    const aiNote = await generateGrokNote(parent_name, parsedChildName, parsedChildAge, leadCity);

    // Дата создания по МСК (GMT+3)
    const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());

    // 1. Отправляем карточку в Telegram администраторам
    const messageId = await sendTelegramAdminNotification({
      leadId,
      parentName: parent_name,
      childName: parsedChildName,
      childAge: parsedChildAge,
      phone,
      city: leadCity,
      aiNote,
    });

    // 2. Формируем порядок колонок от A до M (13 колонок):
    const newRow = [
      leadId,             // A: ID Заявки (lead_id)
      parent_name,        // B: ФИО Родителя (parent_name)
      parsedChildName,    // C: Имя ребенка (child_name)
      parsedChildAge,     // D: Возраст ребенка (только число)
      phone,              // E: Телефон (phone)
      leadCity,           // F: Город (city)
      body.tg_username || body.tgUsername || '-', // G: Telegram Никнейм
      'Новая заявка',     // H: Статус заявки (status)
      '-',                // I: Дата 1-го занятия (first_lesson_date)
      aiNote,             // J: Заметки ИИ (от Grok)
      dateStr,            // K: Дата создания (created_at) -> YYYY-MM-DD
      messageId || '-',   // L: ID сообщения Telegram (tg_message_id)
      body.parent_chat_id || '-' // M: Telegram Chat ID родителя (parent_chat_id)
    ];

    // 3. Сохраняем в Google Таблицу (колонки A:M)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'leads!A:M',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    const botUsername = process.env.NEXT_PUBLIC_TG_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || 'BabyDanceBot';
    const tg_url = `https://t.me/${botUsername}?start=${leadId}`;

    return NextResponse.json({
      status: 'success',
      success: true,
      lead_id: leadId,
      tg_url: tg_url,
      bot_link: tg_url,
    });

  } catch (error: any) {
    console.error('Error in lead API:', error);
    return NextResponse.json(
      { status: 'error', message: error.message || 'Ошибка сервера' },
      { status: 500 }
    );
  }
}