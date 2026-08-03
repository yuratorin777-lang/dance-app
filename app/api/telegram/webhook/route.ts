import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Генерация сетки календаря
function generateCalendar(leadId: string, year: number, month: number) {
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay(); // 0 - Вс, 1 - Пн...
  const startOffset = (firstDay + 6) % 7; // Смещение для Пн=0

  const keyboard: any[][] = [];

  // Шапка: Месяц и Год
  keyboard.push([
    { text: `${monthNames[month]} ${year}`, callback_data: 'ignore' }
  ]);

  // Дни недели
  keyboard.push([
    { text: 'Пн', callback_data: 'ignore' },
    { text: 'Вт', callback_data: 'ignore' },
    { text: 'Ср', callback_data: 'ignore' },
    { text: 'Чт', callback_data: 'ignore' },
    { text: 'Пт', callback_data: 'ignore' },
    { text: 'Сб', callback_data: 'ignore' },
    { text: 'Вс', callback_data: 'ignore' },
  ]);

  // Дни месяца
  let row: any[] = [];
  for (let i = 0; i < startOffset; i++) {
    row.push({ text: ' ', callback_data: 'ignore' });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const formattedDay = String(day).padStart(2, '0');
    const formattedMonth = String(month + 1).padStart(2, '0');
    const dateStr = `${year}-${formattedMonth}-${formattedDay}`;

    row.push({
      text: `${day}`,
      callback_data: `pick_date:${leadId}:${dateStr}`
    });

    if (row.length === 7) {
      keyboard.push(row);
      row = [];
    }
  }

  if (row.length > 0) {
    while (row.length < 7) {
      row.push({ text: ' ', callback_data: 'ignore' });
    }
    keyboard.push(row);
  }

  return keyboard;
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackData = callbackQuery.data || '';
      const message = callbackQuery.message;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (callbackData === 'ignore') {
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
        return NextResponse.json({ ok: true });
      }

      // 1. Кликнули "Записать на урок" -> Показываем календарь
      if (callbackData.startsWith('assign_lesson:')) {
        const leadId = callbackData.split(':')[1];
        const now = new Date();
        const calendarKeyboard = generateCalendar(leadId, now.getFullYear(), now.getMonth());

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: { inline_keyboard: calendarKeyboard }
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Выберите дату занятия' })
        });
      }

      // 2. Выбрали конкретную дату в календаре
      if (callbackData.startsWith('pick_date:')) {
        const [, leadId, selectedDate] = callbackData.split(':');
        const googleScriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;

        // Отправляем запрос в Google Apps Script (ServerAPI.gs)
        if (googleScriptUrl) {
          try {
            await fetch(googleScriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'assign_first_lesson',
                lead_id: leadId,
                first_lesson_date: selectedDate,
              }),
            });
          } catch (err) {
            console.error('Error calling Apps Script:', err);
          }
        }

        // Форматируем красивую дату (например, 15.08.2026)
        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        // Обновляем исходную карточку в топике "Новые заявки"
        const updatedText = `${message.text}\n\n✅ <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ</b>\n📅 Дата: <b>${formattedDisplayDate}</b>`;

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: updatedText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] } // убираем календарь
          })
        });

        // 3. ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ В ТОПИК "Записан на 1-е занятие"
        const firstLessonTopicId = process.env.TELEGRAM_FIRST_LESSON_TOPIC_ID;

        if (firstLessonTopicId) {
          const topicMessage = `
🎉 <b>НОВАЯ ЗАПИСЬ НА 1-Е ЗАНЯТИЕ!</b>

🆔 <b>ID Лида:</b> <code>${leadId}</code>
📅 <b>Дата занятия:</b> <code>${formattedDisplayDate}</code>

📋 <b>Данные заявки:</b>
${message.text}
`.trim();

          const topicPayload: Record<string, any> = {
            chat_id: message.chat.id,
            message_thread_id: Number(firstLessonTopicId),
            text: topicMessage,
            parse_mode: 'HTML',
          };

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(topicPayload),
          });
        }

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: `Записано на ${formattedDisplayDate}` })
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Error in Telegram Webhook:', error);
    return NextResponse.json({ ok: true });
  }
}