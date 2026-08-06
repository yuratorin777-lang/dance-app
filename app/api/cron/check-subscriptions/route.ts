import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Защита авторизации
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const googleScriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL || '';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

  try {
    const res = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_expiring_subscriptions' }),
    });

    const items = await res.json();
    let sentCount = 0;

    for (const item of items) {
      const { studentName, balanceLessons, validUntil, parentTgId, groupChatId, paymentsTopicId, triggerReason } = item;

      let text = '';
      if (triggerReason === 'balance_low') {
        text = `⚠️ <b>Окончание абонемента!</b>\n\nУ ученика <b>${studentName}</b> осталось занятий: <b>${balanceLessons}</b>.\nПожалуйста, позаботьтесь о продлении.`;
      } else if (triggerReason === 'date_expiring') {
        text = `⏳ <b>Срок действия абонемента подходит к концу!</b>\n\nУ ученика <b>${studentName}</b> абонемент действует до <b>${validUntil}</b>.`;
      } else if (triggerReason === 'expired') {
        text = `🚫 <b>Абонемент истек!</b>\n\nСрок действия абонемента ученика <b>${studentName}</b> закончился.`;
      }

      if (!text) continue;

      // 1. Отправляем в ЛС родителю (если привязан Telegram ID)
      if (parentTgId) {
        await sendTelegramMessage(botToken, parentTgId, text);
      }

      // 2. Отправляем в топик «Вопросы по оплате» рабочей группы
      if (groupChatId && paymentsTopicId) {
        await sendTelegramMessage(botToken, groupChatId, text, Number(paymentsTopicId));
      }

      sentCount++;
    }

    return NextResponse.json({ success: true, processed: sentCount });
  } catch (error) {
    console.error('Error in subscription cron:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

async function sendTelegramMessage(token: string, chatId: string | number, text: string, threadId?: number) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: threadId,
        text: text,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error(`Failed to send TG message to ${chatId}:`, err);
  }
}