import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const googleScriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL || '';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

  try {
    // 1. Запрашиваем из Google Apps Script список лидов с занятием на СЕГОДНЯ
    const res = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_today_trial_lessons' }),
    });

    const items = await res.json();
    let sentCount = 0;

    for (const item of items) {
      // parentTgId должен соответствовать колонке с Telegram Chat ID в таблице!
      const { leadId, parentTgId, childName, lessonTime, branchAddress } = item;

      if (!parentTgId || isNaN(Number(parentTgId))) continue;

      const messageText = 
        `Здравствуйте! 💃🏻\n\n` +
        `Напоминаем, что **сегодня** у ребенка **${childName || ''}** запланировано первое пробное занятие!\n\n` +
        `⏰ **Время:** ${lessonTime || 'не указано'}\n` +
        `📍 **Адрес:** ${branchAddress || 'не указан'}\n\n` +
        `Подтвердите, пожалуйста, ваше присутствие:`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Подтверждаю, будем', callback_data: `confirm_trial_yes:${leadId}` }],
          [{ text: '❌ Не сможем прийти', callback_data: `confirm_trial_no:${leadId}` }]
        ]
      };

      // 2. Отправляем сообщение и получаем message_id
      const messageId = await sendTelegramMessage(botToken, parentTgId, messageText, keyboard);

      // 3. Если сообщение отправлено, записываем tg_message_id в таблицу
      if (messageId) {
        await fetch(googleScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_parent_message_id',
            leadId: leadId,
            messageId: messageId
          }),
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
        parse_mode: 'Markdown',
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