import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function formatDate(dateStr: string | Date): string {
  if (!dateStr) return 'не указана';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return String(dateStr);

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}.${month}.${year}`;
}

export async function GET(req: NextRequest) {
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
      const { studentName, balanceLessons, validUntil, diffDays, parentTgId, groupChatId, paymentsTopicId, triggerReason } = item;

      const formattedDate = formatDate(validUntil);

      // Формируем упоминание родителя из Колонки F
      let parentMention = '';
      if (parentTgId) {
        const rawTg = String(parentTgId).trim();
        if (rawTg) {
          if (!rawTg.startsWith('@') && isNaN(Number(rawTg))) {
            parentMention = `@${rawTg}`;
          } else if (rawTg.startsWith('@')) {
            parentMention = rawTg;
          }
        }
      }

      const mentionHeader = parentMention ? `${parentMention}, обратите внимание!\n\n` : '';

      let text = '';
      if (triggerReason === 'balance_low') {
        // ТОЛЬКО про остаток занятий
        text = `${mentionHeader}⚠️ <b>Заканчиваются занятия по абонементу!</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Остаток занятий: <b>${balanceLessons}</b>\n\n` +
               `Пожалуйста, не забудьте своевременно оплатить следующий абонемент! 💃🏻`;
      } else if (triggerReason === 'date_expiring') {
        // ТОЛЬКО про срок действия и сколько дней осталось
        const daysText = diffDays === 0 ? 'сегодня' : `осталось дней: <b>${diffDays}</b>`;
        text = `${mentionHeader}⏳ <b>Заканчивается срок действия абонемента!</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Абонемент действует до: <b>${formattedDate}</b> (${daysText})\n\n` +
               `Пожалуйста, продлите абонемент, чтобы зафиксировать место в группе! 💃🏻`;
      } else if (triggerReason === 'expired') {
        // ТОЛЬКО про то, что срок уже истёк
        text = `${mentionHeader}🚫 <b>Срок действия абонемента истёк!</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Дата окончания: <b>${formattedDate}</b>\n\n` +
               `Для возобновления посещений, пожалуйста, произведите оплату или свяжитесь с администратором.`;
      }

      if (!text) continue;

      // 1. Отправляем в ЛС родителю (только если в колонке F записан числовой ID, а не @username)
      if (parentTgId && !isNaN(Number(parentTgId))) {
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