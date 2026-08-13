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
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  const firstLessonTopicId = process.env.TELEGRAM_FIRST_LESSON_TOPIC_ID || '3'; // Топик 3 по умолчанию

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
      // Поддерживаем все вариации ключей (camelCase, snake_case и русские названия из GAS)
      const leadId = item.leadId || item.lead_id;
      const parentTgId = item.parentTgId || item.parent_chat_id || item.chat_id;
      const parentName = item.parentName || item.parent_name || item['Имя родителя'] || '—';
      const childName = item.childName || item.child_name || item['Имя ребенка'] || '—';
      const phone = item.phone || item['Телефон'] || '—';
      const city = item.city || item['Город'] || '—';
      const lessonTime = item.lessonTime || item.lesson_time || 'не указано';
      const branchAddress = item.branchAddress || item.branch_address || 'не указан';

      const hasBot = parentTgId && !isNaN(Number(parentTgId)) && String(parentTgId) !== '-';

      // -------------------------------------------------------------
      // ШАГ 1: ОТПРАВКА В АДМИНСКИЙ ЧАТ (ТОПИК 3) — РАБОТАЕТ ВСЕГДА!
      // -------------------------------------------------------------
      if (adminChatId) {
        const adminMessageText = 
          `🔔 <b>СЕГОДНЯ ПЕРВОЕ ЗАНЯТИЕ!</b>\n\n` +
          `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
          `👤 <b>Родитель:</b> ${parentName}\n` +
          `👶 <b>Ребенок:</b> ${childName}\n` +
          `📞 <b>Телефон:</b> ${phone}\n` +
          `🏙 <b>Город:</b> ${city}\n` +
          `⏰ <b>Время:</b> ${lessonTime}\n` +
          `📍 <b>Адрес:</b> ${branchAddress}\n\n` +
          `🤖 <b>Статус бота:</b> ${hasBot ? '✅ Подключен к боту' : '❌ Без бота (Сайт/Таблица)'}`;

        const adminKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Подтвердить', callback_data: `admin_confirm:${leadId}` },
              { text: '🚨 Отмена/Перенос', callback_data: `admin_cancel:${leadId}` }
            ]
          ]
        };

        await sendTelegramMessage(botToken, adminChatId, adminMessageText, adminKeyboard, Number(firstLessonTopicId));
      }

      // -------------------------------------------------------------
      // ШАГ 2: ОТПРАВКА РОДИТЕЛЮ В ЛС — ТОЛЬКО ЕСЛИ ЕСТЬ БОТ
      // -------------------------------------------------------------
      if (hasBot) {
        const parentMessageText = 
          `Здравствуйте! 💃🏻\n\n` +
          `Напоминаем, что <b>сегодня</b> у ребенка <b>${childName}</b> запланировано первое пробное занятие!\n\n` +
          `⏰ <b>Время:</b> ${lessonTime}\n` +
          `📍 <b>Адрес:</b> ${branchAddress}\n\n` +
          `Подтвердите, пожалуйста, ваше присутствие:`;

        const parentKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Подтверждаю, будем', callback_data: `confirm_trial_yes:${leadId}` }],
            [{ text: '❌ Не сможем прийти', callback_data: `confirm_trial_no:${leadId}` }]
          ]
        };

        const messageId = await sendTelegramMessage(botToken, parentTgId, parentMessageText, parentKeyboard);

        // Сохраняем message_id, чтобы убрать кнопки после ответа
        if (messageId) {
          await callAppsScript(googleScriptUrl, {
            action: 'save_parent_message_id',
            leadId: leadId,
            messageId: messageId
          });
        }
      }

      sentCount++;
    }

    return NextResponse.json({ success: true, processed: sentCount });
  } catch (error) {
    console.error('Error in trials cron:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

async function sendTelegramMessage(
  token: string, 
  chatId: string | number, 
  text: string, 
  replyMarkup?: any, 
  threadId?: number
): Promise<number | null> {
  try {
    const body: any = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    };

    if (threadId) {
      body.message_thread_id = threadId;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.ok ? data.result.message_id : null;
  } catch (err) {
    console.error(`Failed to send TG message to ${chatId}:`, err);
    return null;
  }
}