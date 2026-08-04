import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Вспомогательная функция для генерации ближайших 7 дней с указанием дня недели
function generateUpcomingDays(leadId: string) {
  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const monthNames = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const keyboard: any[][] = [];

  const today = new Date();
  
  // Генерируем кнопки на 7 дней вперед
  for (let i = 1; i <= 7; i++) {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + i);

    const year = nextDate.getFullYear();
    const month = monthNames[nextDate.getMonth()];
    const day = String(nextDate.getDate()).padStart(2, '0');
    const dayOfWeek = dayNames[nextDate.getDay()];

    const dateStr = `${year}-${month}-${day}`;
    const buttonText = `${day}.${month} (${dayOfWeek})`;

    keyboard.push([
      {
        text: buttonText,
        callback_data: `pick_parent_date:${leadId}:${dateStr}:${dayOfWeek}`
      }
    ]);
  }

  return keyboard;
}

// Генерация сетки календаря для админа
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
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;

    // ==========================================
    // 1. ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ (/start LD-XXXX)
    // ==========================================
    if (update.message && update.message.text) {
      const text = update.message.text.trim();
      const chatId = update.message.chat.id;

      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        const startParam = parts[1] || ''; // Ожидаем ID Лида, например LD-1001

        if (startParam.startsWith('LD-')) {
          const leadId = startParam;
          let parentName = 'Родитель';
          let childName = 'ваш ребёнок';

          // Запрашиваем информацию о лиде из Google Apps Script
          if (googleScriptUrl) {
            try {
              const res = await fetch(googleScriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'get_lead_info',
                  lead_id: leadId,
                }),
              });
              const data = await res.json();
              if (data.parentName) parentName = data.parentName;
              if (data.childName) childName = data.childName;
            } catch (err) {
              console.error('Error fetching lead info:', err);
            }
          }

          const greetingText = `Здравствуйте, <b>${parentName}</b>! Рады приветствовать вас и <b>${childName}</b> в студии Dance Kids! 🩰\n\nВыберите удобный день для первого пробного занятия:`;

          const daysKeyboard = generateUpcomingDays(leadId);

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: greetingText,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: daysKeyboard }
            })
          });

          return NextResponse.json({ ok: true });
        } else {
          // Обычный /start без реферального параметра
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: 'Здравствуйте! Для записи на занятие используйте персональную ссылку с нашего сайта.',
            })
          });
          return NextResponse.json({ ok: true });
        }
      }
    }

    // ==========================================
    // 2. ОБРАБОТКА НАЖАТИЙ НА КНОПКИ (CALLBACKS)
    // ==========================================
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackData = callbackQuery.data || '';
      const message = callbackQuery.message;

      if (callbackData === 'ignore') {
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
        return NextResponse.json({ ok: true });
      }

      // --- АДМИН: Кликнули "Записать на урок" -> Показываем календарь ---
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

      // --- РОДИТЕЛЬ: Выбрал дату из списка ближайших дней ---
      if (callbackData.startsWith('pick_parent_date:')) {
        const [, leadId, selectedDate, dayOfWeek] = callbackData.split(':');

        let availableGroups = [];

        // Запрашиваем подходящие группы из таблицы через Apps Script
        if (googleScriptUrl) {
          try {
            const res = await fetch(googleScriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'get_groups_by_date',
                date: selectedDate,
                day_of_week: dayOfWeek,
                lead_id: leadId,
              }),
            });
            const data = await res.json();
            availableGroups = data.groups || [];
          } catch (err) {
            console.error('Error fetching groups from Apps Script:', err);
          }
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        if (availableGroups.length === 0) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              text: `К сожалению, на ${formattedDisplayDate} (${dayOfWeek}) доступных групп нет. Попробуйте выбрать другой день!`,
            })
          });
        } else {
          // Формируем кнопки с группами
          const groupButtons = availableGroups.map((g: { id: string; name: string; time: string }) => [
            {
              text: `🩰 ${g.name} — ${g.time}`,
              callback_data: `confirm_group:${leadId}:${selectedDate}:${g.id}`
            }
          ]);

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              text: `Отлично! Выбрана дата: <b>${formattedDisplayDate}</b>.\n\nВыберите подходящее время и группу:`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: groupButtons }
            })
          });
        }

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
      }

      // --- РОДИТЕЛЬ: Нажал на кнопку конкретной группы (ФИНАЛЬНАЯ ЗАПИСЬ) ---
      if (callbackData.startsWith('confirm_group:')) {
        const [, leadId, selectedDate, groupId] = callbackData.split(':');

        // 1. Сохраняем дату и меняем статус в Google Таблице
        if (googleScriptUrl) {
          try {
            await fetch(googleScriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'assign_first_lesson',
                lead_id: leadId,
                group_id: groupId,
                first_lesson_date: selectedDate,
              }),
            });
          } catch (err) {
            console.error('Error calling Apps Script:', err);
          }
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        // 2. Гасим спиннер на кнопке Telegram
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Вы успешно записаны!' })
        });

        // 3. Отправляем родителю сообщение с подтверждением
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            text: `🎉 <b>Поздравляем! Вы успешно записаны!</b>\n\n📅 Дата занятия: <b>${formattedDisplayDate}</b>\n\nЖдем вас в нашей студии!`,
            parse_mode: 'HTML'
          })
        });

        // 4. Отправляем уведомление в топик администраторам
        const firstLessonTopicId = process.env.TELEGRAM_FIRST_LESSON_TOPIC_ID;
        if (firstLessonTopicId) {
          const topicMessage = `
🎉 <b>НОВАЯ ЗАПИСЬ НА 1-Е ЗАНЯТИЕ! (Через Telegram Bot)</b>

🆔 <b>ID Лида:</b> <code>${leadId}</code>
🩰 <b>ID Группы:</b> <code>${groupId}</code>
📅 <b>Дата занятия:</b> <code>${formattedDisplayDate}</code>
`.trim();

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              message_thread_id: Number(firstLessonTopicId),
              text: topicMessage,
              parse_mode: 'HTML',
            }),
          });
        }
      }

      // --- АДМИН: Выбор даты прямо из календаря ---
      if (callbackData.startsWith('pick_date:')) {
        const [, leadId, selectedDate] = callbackData.split(':');

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

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        const updatedText = `${message.text}\n\n✅ <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ</b>\n📅 Дата: <b>${formattedDisplayDate}</b>`;

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: updatedText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
          })
        });

        const firstLessonTopicId = process.env.TELEGRAM_FIRST_LESSON_TOPIC_ID;

        if (firstLessonTopicId) {
          const topicMessage = `
🎉 <b>НОВАЯ ЗАПИСЬ НА 1-Е ЗАНЯТИЕ!</b>

🆔 <b>ID Лида:</b> <code>${leadId}</code>
📅 <b>Дата занятия:</b> <code>${formattedDisplayDate}</code>

📋 <b>Данные заявки:</b>
${message.text}
`.trim();

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              message_thread_id: Number(firstLessonTopicId),
              text: topicMessage,
              parse_mode: 'HTML',
            }),
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