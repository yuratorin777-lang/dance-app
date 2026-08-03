import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { parent_name, child_name, phone, city } = await req.json();

    if (!parent_name || !phone) {
      return NextResponse.json(
        { status: 'error', message: 'Имя и телефон обязательны' },
        { status: 400 }
      );
    }

    // Подготовка сервисного аккаунта Google Sheets
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!clientEmail || !privateKey || !spreadsheetId) {
      console.error('Google Sheets env variables missing');
      return NextResponse.json(
        { status: 'error', message: 'Ошибка конфигурации сервера' },
        { status: 500 }
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Формируем новую строку для записи
    const dateStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const newRow = [
      dateStr,          // Дата и время
      parent_name,      // Имя родителя
      child_name || '', // Имя и возраст ребенка
      phone,            // Телефон
      city || 'Серпухов',// Город / Филиал
      'Новая'           // Статус заявки
    ];

    // Добавляем запись во вкладку "leads" (или "Заявки")
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'leads!A:F', // или 'Заявки!A:F' в зависимости от имени вкладки
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    // Ссылка на Telegram-бота с диплинком (передача имени или id)
    const botUsername = process.env.NEXT_PUBLIC_TG_BOT_USERNAME || 'BabyDanceBot';
    const tg_url = `https://t.me/${botUsername}?start=lead`;

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