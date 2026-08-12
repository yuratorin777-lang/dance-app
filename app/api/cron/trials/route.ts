import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function callAppsScript(url: string, payload: object) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (err) {
    console.error('Error in callAppsScript:', err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const googleScriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL || process.env.APPS_SCRIPT_WEBHOOK_URL || '';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

  if (!googleScriptUrl || !botToken) {
    return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
  }

  try {
    // 1. Запрашиваем из GAS список лидов с занятием на СЕГОДНЯ
    const items = await callAppsScript(googleScriptUrl, { action: 'get_today_trial_lessons' });

    if (!Array.isArray(items)) {
      return NextResponse.json({ success: true, processed: 0, message: 'No lessons today or invalid response' });
    }

    let sentCount = 0;

    for (const item of items) {
      // Унифицированные ключи: поддерживаем camelCase и snake_case
      const leadId = item.leadId || item.lead_id;
      const parentTgId = item.parentTgId || item.parent_chat_id || item.chat_id;
      const childName = item.childName || item.child_name || '';
      const lessonTime = item.lessonTime || item.lesson_time || 'не указано';
      const branchAddress = item.branchAddress || item.branch_address || 'не указан';

      if (!parentTgId || isNaN(Number(parentTgId))) continue;

      const messageText = 
        `Здравствуйте! 💃🏻\n\n` +
        `Напоминаем, что <b>сегодня</b> у ребенка <b>${childName}</b> запланировано первое пробное занятие!\n\n` +
        `⏰ <b>Время:</b> ${lessonTime}\n` +
        `📍 <b>Адрес:</b> ${branchAddress}\n\n` +
        `Подтвердите, пожалуйста, ваше присутствие:`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Подтверждаю, будем', callback_data: `confirm_trial_yes:${leadId}` }],
          [{ text: '❌ Не сможем прийти', callback_data: `confirm_trial_no:${leadId}` }]
        ]
      };

      // 2. Отправляем сообщение в Telegram
      const messageId = await sendTelegramMessage(botToken, parentTgId, messageText, keyboard);

      // 3. Сохраняем tg_message_id в таблицу для последующего скрытия кнопок
      if (messageId) {
        await callAppsScript(googleScriptUrl, {
          action: 'save_parent_message_id',
          leadId: leadId,
          messageId: messageId
        });
        sentCount++;
      }
    }

    return NextResponse.json({ success: true, processed: sentCount });
  } catch (error) {
    console.error('Error in trials cron:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

async function sendTelegramMessage(token: string, chatId: string | number, text: string, replyMarkup?: any): Promise<number | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      }),
    });
    const data = await res.json();
    return data.ok ? data.result.message_id : null;
  } catch (err) {
    console.error(`Failed to send TG message to ${chatId}:`, err);
    return null;
  }
}