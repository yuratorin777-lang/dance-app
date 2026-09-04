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

  let tgCount = 0;
  let pushCount = 0;

  // ==========================================
  // БЛОК 1: TELEGRAM
  // ==========================================
  try {
    const resTg = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_expiring_subscriptions' }),
    });

    const itemsTg = await resTg.json();

    for (const item of itemsTg) {
      const { 
        studentName, 
        balanceLessons, 
        validUntil, 
        diffDays, 
        parentTgId, 
        groupChatId, 
        paymentsTopicId, 
        triggerReason,
        phone, 
        parentPhone 
      } = item;

      const formattedDate = formatDate(validUntil);
      const userPhone = phone || parentPhone || '';
      const loginUrl = userPhone 
        ? `https://dancekids-lk.vercel.app/login?phone=${encodeURIComponent(userPhone)}`
        : `https://dancekids-lk.vercel.app/login`;

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

      if (triggerReason === 'balance_one') {
        // 1. Осталось 1 занятие
        text = `${mentionHeader}🔔 <b>Напоминание о занятии</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `У вас осталось <b>последнее 1 занятие</b> по текущему абонементу.\n\n` +
               `Пожалуйста, оформите новый абонемент заранее, чтобы не пропустить следующие тренировки! 💃🏻`;

      } else if (triggerReason === 'balance_zero') {
        // 2. Осталось 0 занятий
        text = `${mentionHeader}✨ <b>Занятия по абонементу завершены</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Все занятия по вашему абонементу использованы (остаток: 0).\n\n` +
               `Чтобы продолжить посещать занятия без перерыва, пожалуйста, произведите оплату следующего абонемента. 🌸`;

      } else if (triggerReason === 'balance_negative') {
        // 3. Ушел в минус (Мягкое и лояльное)
        const absBalance = Math.abs(balanceLessons);
        text = `${mentionHeader}🤝 <b>Занятие в счет следующего абонемента</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Вы посетили занятие сверх баланса (посещений в счет нового абонемента: <b>${absBalance}</b>).\n\n` +
               `Пожалуйста, продлите абонемент в ближайшее время, чтобы мы могли зафиксировать оплату. Спасибо, что вы с нами! ❤️`;

      } else if (triggerReason === 'balance_low') {
        // Запасная логика для старых триггеров
        text = `${mentionHeader}⚠️ <b>Заканчиваются занятия по абонементу!</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Остаток занятий: <b>${balanceLessons}</b>\n\n` +
               `Пожалуйста, не забудьте своевременно оплатить следующий абонемент! 💃🏻`;

      } else if (triggerReason === 'date_expiring') {
        // 4. Заканчивается срок по дате
        const daysText = diffDays === 0 ? 'сегодня' : `осталось дней: <b>${diffDays}</b>`;
        text = `${mentionHeader}⏳ <b>Заканчивается срок действия абонемента!</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Абонемент действует до: <b>${formattedDate}</b> (${daysText})\n\n` +
               `Пожалуйста, продлите абонемент, чтобы зафиксировать место в группе! 💃🏻`;

      } else if (triggerReason === 'expired') {
        // 5. Истек срок по дате
        text = `${mentionHeader}📅 <b>Истёк срок действия абонемента</b>\n\n` +
               `Ученик: <b>${studentName}</b>\n` +
               `Срок действия абонемента завершился <b>${formattedDate}</b>.\n\n` +
               `Для возобновления посещений, пожалуйста, произведите оплату или свяжитесь с администратором.`;
      }

      if (!text) continue;

      if (parentTgId && !isNaN(Number(parentTgId))) {
        await sendTelegramMessage(botToken, parentTgId, text, loginUrl);
      }

      if (groupChatId && paymentsTopicId) {
        await sendTelegramMessage(botToken, groupChatId, text, loginUrl, Number(paymentsTopicId));
      }

      tgCount++;
    }
  } catch (err) {
    console.error('Error in Telegram cron section:', err);
  }

  // ==========================================
  // БЛОК 2: PWA WEB PUSH
  // ==========================================
  try {
    const resPwa = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_pwa_expiring_subscriptions' }),
    });

    const itemsPwa = await resPwa.json();

    for (const item of itemsPwa) {
      const { studentName, balanceLessons, validUntil, triggerReason, phone, subscription } = item;
      const formattedDate = formatDate(validUntil);
      const loginUrl = phone 
        ? `https://dancekids-lk.vercel.app/login?phone=${encodeURIComponent(phone)}`
        : `https://dancekids-lk.vercel.app/login`;

      let pushTitle = 'DanceKidsPRO';
      let pushText = '';

      if (triggerReason === 'balance_one') {
        pushTitle = `Осталось 1 занятие (${studentName})`;
        pushText = `Оформить новый абонемент можно в Личном Кабинете!`;
      } else if (triggerReason === 'balance_zero') {
        pushTitle = `Занятия завершены (${studentName})`;
        pushText = `Остаток 0 занятий. Продлите абонемент для продолжения!`;
      } else if (triggerReason === 'balance_negative') {
        pushTitle = `Занятие в счет абонемента (${studentName})`;
        pushText = `Посещений сверх баланса: ${Math.abs(balanceLessons)}. Пополните счет в ЛК!`;
      } else if (triggerReason === 'balance_low') {
        pushTitle = `Занятия заканчиваются (${studentName})`;
        pushText = `Осталось занятий: ${balanceLessons}. Пополните баланс в ЛК!`;
      } else if (triggerReason === 'date_expiring') {
        pushTitle = `Срок абонемента истекает (${studentName})`;
        pushText = `Действует до ${formattedDate}. Продлите абонемент в ЛК!`;
      } else if (triggerReason === 'expired') {
        pushTitle = `Абонемент истёк (${studentName})`;
        pushText = `Дата окончания: ${formattedDate}. Оплатите для возобновления посещений.`;
      }

      if (subscription) {
        await sendWebPushNotification(subscription, pushTitle, pushText, loginUrl);
        pushCount++;
      }
    }
  } catch (err) {
    console.error('Error in PWA push cron section:', err);
  }

  return NextResponse.json({ success: true, processedTg: tgCount, processedPwa: pushCount });
}

async function sendTelegramMessage(token: string, chatId: string | number, text: string, loginUrl: string, threadId?: number) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: threadId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💳 Оплатить в Личном Кабинете',
                url: loginUrl
              }
            ]
          ]
        }
      }),
    });
  } catch (err) {
    console.error(`Failed to send TG message to ${chatId}:`, err);
  }
}

async function sendWebPushNotification(subscription: string | object, title: string, body: string, url: string) {
  try {
    const pushAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dancekids-lk.vercel.app';
    const subPayload = typeof subscription === 'object' ? JSON.stringify(subscription) : subscription;

    await fetch(`${pushAppUrl}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subPayload,
        title: title,
        body: body,
        url: url
      }),
    });
  } catch (err) {
    console.error('Failed to send Push notification:', err);
  }
}