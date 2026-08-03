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

    // Пытаемся отделить имя ребенка от возраста, если написано "Ева 3 года"
    let parsedChildName = child_name || '';
    let parsedChildAge = '';

    if (child_name) {
      const parts = child_name.split(',');
      if (parts.length > 1) {
        parsedChildName = parts[0].trim();
        parsedChildAge = parts.slice(1).join(',').trim();
      }
    }

    const dateStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    // Строго формируем порядок колонок от A до K:
    const newRow = [
      leadId,             // A: ID Заявки (lead_id)
      parent_name,        // B: ФИО Родителя (parent_name)
      parsedChildName,    // C: Имя ребенка (child_name)
      parsedChildAge,     // D: Возраст ребенка (child_age)
      phone,              // E: Телефон (phone)
      city || 'Серпухов', // F: Город (city)
      '-',                // G: Telegram Никнейм (tg_username)
      'Новая',            // H: Статус заявки (status)
      '-',                // I: Дата 1-го занятия (first_lesson_date)
      'Заявка с веб-сайта',// J: Заметки ИИ / Админа (notes)
      dateStr             // K: Дата создания (created_at)
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