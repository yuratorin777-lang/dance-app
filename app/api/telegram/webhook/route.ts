import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ============================================================================
// 📌 SECTION 1: HELPER FUNCTIONS & KEYBOARD GENERATORS
// ============================================================================

/**
 * Генератор клавиатуры с доступными днями на 14 дней вперёд.
 * Фильтрует дни строго по активному расписанию конкретного города (из Лида).
 * @param leadId - ID лида (например, LD-1234)
 * @param googleScriptUrl - URL Google Apps Script
 * @param targetRole - 'parent' или 'admin' (определяет prefix для callback_data)
 */
async function generateUpcomingDays(
  leadId: string, 
  googleScriptUrl: string, 
  targetRole: 'parent' | 'admin' = 'parent'
) {
  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const monthNames = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const keyboard: any[][] = [];

  // 1. Запрашиваем активные дни недели ИМЕННО ДЛЯ ГОРОДА ЛИДА
  let activeDays: string[] = [];
  if (googleScriptUrl) {
    try {
      const res = await fetch(googleScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'get_available_days',
          lead_id: leadId 
        }),
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        activeDays = data;
      }
    } catch (err) {
      console.error('Error fetching available days for city:', err);
    }
  }

  const today = new Date();
  
  // 2. Ищем ближайшие совпадения дат на 14 дней вперед
  for (let i = 1; i <= 14; i++) {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + i);

    const year = nextDate.getFullYear();
    const month = monthNames[nextDate.getMonth()];
    const day = String(nextDate.getDate()).padStart(2, '0');
    const dayOfWeek = dayNames[nextDate.getDay()];

    // Показываем день, только если в этот день недели есть занятия в городе лида
    if (activeDays.length === 0 || activeDays.includes(dayOfWeek)) {
      const dateStr = `${year}-${month}-${day}`;
      const buttonText = `${day}.${month} (${dayOfWeek})`;
      const callbackPrefix = targetRole === 'admin' ? 'pick_admin_date' : 'pick_parent_date';

      keyboard.push([
        {
          text: buttonText,
          callback_data: `${callbackPrefix}:${leadId}:${dateStr}:${dayOfWeek}`
        }
      ]);

      if (keyboard.length >= 7) break;
    }
  }

  return keyboard;
}

// ============================================================================
// 📌 SECTION 2: MAIN WEBHOOK HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL || '';
    const firstLessonTopicId = process.env.TELEGRAM_FIRST_LESSON_TOPIC_ID || '3';

    // ------------------------------------------------------------------------
    // SUB-SECTION 2.1: MESSAGES & /START COMMAND (PARENT ENTRYPOINT)
    // ------------------------------------------------------------------------
    if (update.message && update.message.text) {
      const text = update.message.text.trim();
      const chatId = update.message.chat.id;

      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        const startParam = parts[1] || '';

        if (startParam.startsWith('LD-')) {
          const leadId = startParam;
          let parentName = 'Родитель';
          let childName = 'ваш ребёнок';

          if (googleScriptUrl) {
            try {
              const res = await fetch(googleScriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'get_lead_info', lead_id: leadId }),
              });
              const data = await res.json();
              if (data.parentName) parentName = data.parentName;
              if (data.childName) childName = data.childName;
            } catch (err) {
              console.error('Error fetching lead info:', err);
            }
          }

          const daysKeyboard = await generateUpcomingDays(leadId, googleScriptUrl, 'parent');

          // Если в городе лида пока нет расписания
          if (daysKeyboard.length === 0) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `Здравствуйте, <b>${parentName}</b>! В вашем городе сейчас формируется расписание. Наш менеджер свяжется с вами в ближайшее время!`,
                parse_mode: 'HTML'
              })
            });
            return NextResponse.json({ ok: true });
          }

          const greetingText = `Здравствуйте, <b>${parentName}</b>! Рады приветствовать вас и <b>${childName}</b> в студии Dance Kids! 🩰\n\nВыберите удобный день для первого пробного занятия:`;

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

    // ------------------------------------------------------------------------
    // SUB-SECTION 2.2: CALLBACK QUERIES (BUTTON PRESSES)
    // ------------------------------------------------------------------------
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

      // ======================================================================
      // 📌 SECTION 3: PARENT USER FLOW (CALLBACKS)
      // ======================================================================

      // --- РОДИТЕЛЬ: Выбрал дату из умного списка ---
      if (callbackData.startsWith('pick_parent_date:')) {
        const [, leadId, selectedDate, dayOfWeek] = callbackData.split(':');
        let availableGroups = [];

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
          const groupButtons = availableGroups.map((g: { id: string; name: string; time: string }) => [
            {
              text: `🩰 ${g.name} — ${g.time}`,
              callback_data: `confirm_parent_group:${leadId}:${selectedDate}:${g.id}`
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

      // --- РОДИТЕЛЬ: Подтвердил выбор конкретной группы (ФИНАЛ) ---
      if (callbackData.startsWith('confirm_parent_group:')) {
        const [, leadId, selectedDate, groupId] = callbackData.split(':');
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID; // ID группы/супергруппы

        let leadDetails: any = null;

        if (googleScriptUrl) {
          try {
            const res = await fetch(googleScriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'assign_first_lesson',
                lead_id: leadId,
                group_id: groupId,
                first_lesson_date: selectedDate,
                by_parent: true
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.lead) {
                leadDetails = data.lead;
              }
            }
          } catch (err) {
            console.error('Error calling Apps Script in parent flow:', err);
          }
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        // 1. Редактируем карточку в админском топике "Новые заявки" (убираем кнопки, меняем статус)
        const targetChatId = leadDetails?.chat_id || adminChatId;
        const cardMessageId = leadDetails?.tg_message_id;

        if (targetChatId && cardMessageId) {
          const updatedCardText = 
            `🔥 <b>ЗАЯВКА ОБНОВЛЕНА!</b>\n\n` +
            `🆔 <b>ID Заявки:</b> <code>${leadId}</code>\n` +
            `👤 <b>Родитель:</b> ${leadDetails?.parentName || '—'}\n` +
            `👶 <b>Ребенок:</b> ${leadDetails?.childName || '—'}\n` +
            `📞 <b>Телефон:</b> ${leadDetails?.phone || '—'}\n` +
            `🏙 <b>Город:</b> ${leadDetails?.city || '—'}\n\n` +
            `✅ <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ</b>\n` +
            `📅 <b>Дата:</b> <code>${formattedDisplayDate}</code>\n` +
            `🩰 <b>Группа:</b> <code>${groupId}</code>\n` +
            `✨ <i>Родитель записался сам через бота</i>`;

          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              message_id: cardMessageId,
              text: updatedCardText,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [] }
            })
          }).catch(err => console.error('Error editing admin card:', err));
        }

        // 2. Отправляем уведомление во 2-й топик ("Записан на 1-е занятие", ID топика = firstLessonTopicId)
        if (targetChatId) {
          const topicMessageText = 
            `🎉 <b>НОВАЯ ЗАПИСЬ НА 1-Е ЗАНЯТИЕ!</b> (Родитель записался сам)\n\n` +
            `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
            `📅 <b>Дата занятия:</b> <code>${formattedDisplayDate}</code>\n` +
            `🩰 <b>ID Группы:</b> <code>${groupId}</code>\n\n` +
            `📋 <b>Данные заявки:</b>\n` +
            `👤 <b>Родитель:</b> ${leadDetails?.parentName || '—'}\n` +
            `👶 <b>Ребенок:</b> ${leadDetails?.childName || '—'}\n` +
            `📞 <b>Телефон:</b> ${leadDetails?.phone || '—'}\n` +
            `🏙 <b>Город:</b> ${leadDetails?.city || '—'}`;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              message_thread_id: Number(firstLessonTopicId),
              text: topicMessageText,
              parse_mode: 'HTML'
            })
          }).catch(err => console.error('Error sending to first lesson topic:', err));
        }

        // 3. Отвечаем родителю в его личный чат
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Вы успешно записаны!' })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            text: `🎉 <b>Поздравляем! Вы успешно записаны!</b>\n\n📅 Дата занятия: <b>${formattedDisplayDate}</b>\n\nЖдем вас в нашей студии!`,
            parse_mode: 'HTML'
          })
        });

        return NextResponse.json({ ok: true });
      }

      // ======================================================================
      // 📌 SECTION 4: ADMIN WORKSPACE FLOW (GROUP TOPICS & ACTIONS)
      // ======================================================================

      // --- АДМИН: Нажал "Записать на урок" под карточкой заявки ---
      if (callbackData.startsWith('assign_lesson:')) {
        const leadId = callbackData.split(':')[1];
        
        // Получаем клавиатуру актуальных дней по ГОРОДУ ЛИДА
        const daysKeyboard = await generateUpcomingDays(leadId, googleScriptUrl, 'admin');

        if (daysKeyboard.length === 0) {
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id, 
              text: 'В расписании данного города нет активных дней!',
              show_alert: true
            })
          });
          return NextResponse.json({ ok: true });
        }

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: { inline_keyboard: daysKeyboard }
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Выберите дату для лида' })
        });
      }

      // --- АДМИН: Выбрал конкретную дату из актуального списка ---
      if (callbackData.startsWith('pick_admin_date:')) {
        const [, leadId, selectedDate, dayOfWeek] = callbackData.split(':');
        let availableGroups = [];

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
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id, 
              text: `На ${formattedDisplayDate} (${dayOfWeek}) нет активных групп!`,
              show_alert: true 
            })
          });
        } else {
          // Кнопки выбора конкретной группы для АДМИНА
          const groupButtons = availableGroups.map((g: { id: string; name: string; time: string }) => [
            {
              text: `🩰 ${g.name} — ${g.time}`,
              callback_data: `confirm_admin_group:${leadId}:${selectedDate}:${g.id}`
            }
          ]);

          await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: { inline_keyboard: groupButtons }
            })
          });

          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id, text: `Дата ${formattedDisplayDate}. Выберите группу:` })
          });
        }
      }

      // --- АДМИН: Подтвердил выбор группы (ФИНАЛ АДМИН-ЗАПИСИ) ---
      if (callbackData.startsWith('confirm_admin_group:')) {
        const [, leadId, selectedDate, groupId] = callbackData.split(':');

        // 1. СРАЗУ сбрасываем кнопки у сообщения, чтобы блокировать повторные клики (защита от дублей)
        await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: { inline_keyboard: [] }
          })
        });

        let success = false;

        // 2. Сохраняем в Google Таблицу через GAS с проверкой ответа
        if (googleScriptUrl) {
          try {
            const res = await fetch(googleScriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'assign_first_lesson',
                lead_id: leadId,
                group_id: groupId,
                first_lesson_date: selectedDate,
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.status === 'success' || data.ok) {
                success = true;
              }
            }
          } catch (err) {
            console.error('Error calling Apps Script in admin flow:', err);
          }
        } else {
          success = true; // Для тестового режима без GAS
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        if (success) {
          // 3. Обновляем исходный пост в теме "Новые заявки"
          const updatedText = `${message.text}\n\n✅ <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ (Администратором)</b>\n📅 Дата: <b>${formattedDisplayDate}</b>\n🆔 Группа: <code>${groupId}</code>`;

          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              message_id: message.message_id,
              text: updatedText,
              parse_mode: 'HTML',
            })
          });

          // 4. Отправляем карточку во 2-й топик («Записан на 1-е занятие») СТРОГО 1 раз
          const topicMessage = `
🎉 <b>НОВАЯ ЗАПИСЬ НА 1-Е ЗАНЯТИЕ! (Записал админ)</b>

🆔 <b>ID Лида:</b> <code>${leadId}</code>
📅 <b>Дата занятия:</b> <code>${formattedDisplayDate}</code>
🩰 <b>ID Группы:</b> <code>${groupId}</code>

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

          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id,
              text: `Записано на ${formattedDisplayDate}`
            })
          });
        } else {
          // Если запись в Таблицу не удалась
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id,
              text: 'Ошибка при сохранении в Google Таблицу!',
              show_alert: true
            })
          });
        }

        return NextResponse.json({ ok: true });
      } // Закрываем if (callbackData.startsWith('confirm_admin_group:'))
    } // Закрываем if (update.callback_query)

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Error in Telegram Webhook:', error);
    return NextResponse.json({ ok: true });
  }
} // Закрываем export async function POST