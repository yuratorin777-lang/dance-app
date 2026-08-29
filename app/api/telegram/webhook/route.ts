import { NextRequest, NextResponse } from 'next/server';
import { analyzeReceipt } from '../../ocr/receipt/route';
import { analyzeMedicalDoc } from '../../ocr/medical/route';

export const dynamic = 'force-dynamic';

// ============================================================================
// 📌 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И КОНФИГУРАЦИИ (ГЛОБАЛЬНЫЙ УРОВЕНЬ)
// ============================================================================

// Скачивание файла из Telegram в Base64
async function downloadTelegramFileAsBase64(fileUrl: string): Promise<string | null> {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (e) {
    console.error('Error downloading Telegram file to base64:', e);
    return null;
  }
}

// Вызов Google Apps Script
async function callAppsScript(url: string, payload: object) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    
    if (!res.ok) {
      console.error(`Apps Script returned status ${res.status}`);
      return null;
    }
    
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('Apps Script response is not JSON:', text);
      return null;
    }
  } catch (err) {
    console.error('Error calling Apps Script:', err);
    return null;
  }
}

// Информационные материалы
const INFO_MATERIALS: Record<string, string> = {
  clothes: `👕 <b>Что надеть на первое занятие:</b>\n\n` +
            `• Удобная спортивная одежда (легинсы/шорты, футболка)\n` +
            `• Чешки или носочки (балетки, если есть)\n` +
            `• Волосы аккуратно убраны в пучок или хвостик\n` +
            `• Бутылочка питьевой воды без газа`,

  location: `📍 <b>Как добраться:</b>\n\n` +
            `Адрес нашей студии и подробную схему прохода с фото/видео вы можете уточнить у администратора или посмотреть на нашем сайте.\n\n` +
            `<i>Приходите за 10–15 минут до начала занятия, чтобы успеть переодеться!</i>`,

  prices: `💳 <b>Цены и условия:</b>\n\n` +
          `• Первое пробное занятие — <b>БЕСПЛАТНО</b>\n` +
          `• Абонемент на 8 занятий — от 3 500 ₽\n` +
          `• Абонемент на 12 занятий — от 4 800 ₽\n\n` +
          `<i>Подробный прайс-лист и скидки семейным картам уточняйте у администратора.</i>`,

  links: `🔗 <b>Полезные ссылки и соцсети:</b>\n\n` +
         `• Наш Telegram-канал: https://t.me/dancekids\n` +
         `• Группа ВКонтакте: https://vk.com/dancekids\n` +
         `• Отзывы родителей: https://vk.com/reviews`
};

function getInfoMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '👕 Что надеть?', callback_data: 'info_clothes' },
        { text: '📍 Как добраться?', callback_data: 'info_location' }
      ],
      [
        { text: '💳 Цены и условия', callback_data: 'info_prices' },
        { text: '🔗 Соцсети и ссылки', callback_data: 'info_links' }
      ]
    ]
  };
}

function getBackToMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⬅️ Назад в меню', callback_data: 'info_main_menu' }]
    ]
  };
}

// Генератор дат
async function generateUpcomingDays(
  leadId: string, 
  googleScriptUrl: string, 
  targetRole: 'parent' | 'admin' = 'parent'
) {
  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const monthNames = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const keyboard: any[][] = [];

  let activeDays: string[] = [];
  if (googleScriptUrl) {
    const data = await callAppsScript(googleScriptUrl, {
      action: 'get_available_days',
      lead_id: leadId
    });
    if (Array.isArray(data)) {
      activeDays = data;
    }
  }

  const today = new Date();
  
  for (let i = 1; i <= 14; i++) {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + i);

    const year = nextDate.getFullYear();
    const month = monthNames[nextDate.getMonth()];
    const day = String(nextDate.getDate()).padStart(2, '0');
    const dayOfWeek = dayNames[nextDate.getDay()];

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
// 🌐 CORS ОБРАБОТКА (ДЛЯ Cross-Origin ЗАПРОСОВ ИЗ ЛК / PWA)
// ============================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// ============================================================================
// 🚀 ОСНОВНОЙ РОУТ WEBHOOK (POST)
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

          if (googleScriptUrl) {
            await callAppsScript(googleScriptUrl, {
              action: 'save_parent_chat_id',
              lead_id: leadId,
              chat_id: chatId
            });
          }

          let parentName = 'Родитель';
          let childName = 'ваш ребёнок';

          if (googleScriptUrl) {
            const data = await callAppsScript(googleScriptUrl, {
              action: 'get_lead_info',
              lead_id: leadId
            });
            if (data) {
              if (data.parentName) parentName = data.parentName;
              if (data.childName) childName = data.childName;
            }
          }

          const daysKeyboard = await generateUpcomingDays(leadId, googleScriptUrl, 'parent');

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
            return NextResponse.json({ ok: true }, { headers: corsHeaders });
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

          return NextResponse.json({ ok: true }, { headers: corsHeaders });
        } else {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: 'Здравствуйте! Для записи на занятие используйте персональную ссылку с нашего сайта.',
            })
          });
          return NextResponse.json({ ok: true }, { headers: corsHeaders });
        }
      }
    }

  // ------------------------------------------------------------------------
// SUB-SECTION 2.1.1: ОБРАБОТКА ФОТО/ДОКУМЕНТОВ И ЗАМОРОЗКИ ИЗ ЛК / TELEGRAM
// ------------------------------------------------------------------------

// 🟢 1. ИЗОЛИРОВАННАЯ ОБРАБОТКА ЗАМОРОЗКИ ИЗ ЛК (С КНОПКАМИ В АДМИН-ЧАТ)
if (update.action === 'REQUEST_FREEZE_FROM_LK' || update.action === 'request_freeze') {
  if (googleScriptUrl) {
    try {
      let ocrData: any = null;
      const docUrl = update.fileUrl || update.docUrl || '';

      if (docUrl) {
        try {
          const imageBase64 = await downloadTelegramFileAsBase64(docUrl);
          if (imageBase64) {
            const mimeType = docUrl.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
            ocrData = await analyzeMedicalDoc(imageBase64, mimeType, update.reason || '');
          }
        } catch (ocrErr) {
          console.error('Ошибка OCR для файла из ЛК (заморозка):', ocrErr);
        }
      }

      const startDate = ocrData?.startDate || ocrData?.start_date || update.startDate || null;
      const endDate = ocrData?.endDate || ocrData?.end_date || update.endDate || null;
      const reason = ocrData?.reason || update.reason || 'Запрос заморозки из ЛК';

      const result = await callAppsScript(googleScriptUrl, {
        action: 'APPLY_FREEZE',
        leadId: update.leadId || update.studentId,
        studentId: update.studentId || update.leadId,
        startDate: startDate,
        endDate: endDate,
        reason: reason,
        docUrl: docUrl,
        fileUrl: docUrl,
        source: 'LK'
      });

      const freezeId = result?.freezeId || update.leadId || Date.now();
      const adminGroupId = process.env.TELEGRAM_ADMIN_GROUP_ID;
      const freezeTopicId = process.env.TELEGRAM_FREEZE_TOPIC_ID;

      if (adminGroupId && botToken) {
        const adminMsg = `❄️ <b>Запрос на заморозку из ЛК</b>\n\n` +
          `👤 <b>Ученик/Лид:</b> ${update.studentName || update.leadId || 'Не указан'}\n` +
          `📅 <b>Период:</b> с ${startDate || '—'} по ${endDate || '—'}\n` +
          `📝 <b>Причина:</b> ${reason}\n` +
          `${docUrl ? `📄 <a href="${docUrl}">Открыть документ</a>` : ''}`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: adminGroupId,
            ...(freezeTopicId ? { message_thread_id: Number(freezeTopicId) } : {}),
            text: adminMsg,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Одобрить', callback_data: `freeze_approve:${freezeId}` },
                  { text: '❌ Отклонить', callback_data: `freeze_reject:${freezeId}` }
                ]
              ]
            }
          })
        }).catch(err => console.error('Error sending freeze alert to admin group:', err));
      }

      return NextResponse.json({ ok: true, result, ocrData }, { headers: corsHeaders });
    } catch (err) {
      console.error('Error forwarding freeze request to Apps Script:', err);
      return NextResponse.json({ ok: false, error: 'Apps Script error' }, { status: 500, headers: corsHeaders });
    }
  }
  return NextResponse.json({ ok: false, error: 'No Script URL' }, { status: 500, headers: corsHeaders });
}

// 🔵 2. ОБРАБОТКА ФОТО И ДОКУМЕНТОВ (ТЕЛЕГРАМ / DIRECT API ИЗ ЛК)
const msg = update.message || update.edited_message;
const isDirectApiCall = update.action === 'APPLY_FREEZE' || update.action === 'PROCESS_RECEIPT' || update.action === 'REQUEST_FREEZE_FROM_LK' || update.action === 'request_freeze';

if ((msg && (msg.photo || msg.document)) || isDirectApiCall) {
  let chatId = msg?.chat?.id || update.chat_id || update.telegram_id || null;
  let threadId = msg?.message_thread_id || update.thread_id || update.topic_id || null;
  let caption = (msg?.caption || update.searchQuery || '').trim();

  let fileUrl = update.fileUrl || update.docUrl || '';
  let studentId = update.studentId || null;
  let ocrData: any = null;

  // 1. ОПРЕДЕЛЕНИЕ ТИПА ДОКУМЕНТА (СПРАВКА ИЛИ ЧЕК)
  let isMedical = update.action === 'APPLY_FREEZE' || update.action === 'REQUEST_FREEZE_FROM_LK' || update.action === 'request_freeze';

  if (msg) {
    const fileName = msg.document?.file_name || '';
    const lowerCaption = caption.toLowerCase();
    const lowerFileName = fileName.toLowerCase();

    // Сверяем топик справок
    const envMedicalTopicId = process.env.TELEGRAM_MEDICAL_TOPIC_ID;
    const isMedicalTopic = !!envMedicalTopicId && (String(threadId).trim() === String(envMedicalTopicId).trim());

    // Расширенный поиск ключевых слов
    const medicalKeywords = ['справка', 'больничный', 'мед', 'освобождение', 'освобожден', 'врач', 'illness', 'doctor', 'заболел', 'болел', 'диагноз', 'педиатр', 'клиника', 'больница', 'справку', 'болеем'];
    const hasMedicalKeywords = medicalKeywords.some(kw => lowerCaption.includes(kw) || lowerFileName.includes(kw));

    // PDF документы почти всегда являются справками
    const isPdf = msg.document?.mime_type === 'application/pdf' || lowerFileName.endsWith('.pdf');

    if (isMedicalTopic || hasMedicalKeywords || isPdf) {
      isMedical = true;
    }
  }

  const fileId = msg?.photo 
    ? msg.photo[msg.photo.length - 1].file_id 
    : msg?.document?.file_id;

  let imageBase64: string | null = null;

  if (fileId && botToken) {
    try {
      const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();
      if (fileData.ok && fileData.result?.file_path) {
        fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        imageBase64 = await downloadTelegramFileAsBase64(fileUrl);
      }
    } catch (e) {
      console.error('Error fetching Telegram file URL:', e);
    }
  }

  // Извлечение ID ученика из подписи (STD-123, ST-123 или LD-123)
  const studentIdMatch = caption.match(/(STD-\d+|ST-\d+|LD-\d+)/i);
  if (studentIdMatch) {
    studentId = studentIdMatch[0].toUpperCase();
  }

  const mimeType = msg?.document?.mime_type || (fileUrl.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

  // 2. OCR ОБРАБОТКА
  if (imageBase64) {
    try {
      if (isMedical) {
        ocrData = await analyzeMedicalDoc(imageBase64, mimeType, caption);
      } else {
        // Сначала пробуем распознать чек
        const receiptCheck = await analyzeReceipt(imageBase64, mimeType, caption);
        
        // Если OCR вернул сумму или реквизиты — это однозначно чек
        if (receiptCheck && (receiptCheck.amount || receiptCheck.date)) {
          ocrData = receiptCheck;
          isMedical = false;
        } else {
          // Если чек не распознался, проверяем не справка ли это
          const medicalCheck = await analyzeMedicalDoc(imageBase64, mimeType, caption);
          if (medicalCheck && (medicalCheck.startDate || medicalCheck.childName || medicalCheck.child_name)) {
            ocrData = medicalCheck;
            isMedical = true; // Переключаем на справку
          } else {
            ocrData = receiptCheck; // Фоллбэк на чек
          }
        }
      }
    } catch (err) {
      console.error('Gemini OCR process error:', err);
    }
  }

  // 3. ОТПРАВКА В GOOGLE APPS SCRIPT
if (googleScriptUrl) {
  const targetAction = isMedical ? 'APPLY_FREEZE' : 'PROCESS_RECEIPT';

  // ПРИОРИТЕТ ДЛЯ ПОИСКА:
  // 1. Извлеченный STD/LD ID из подписи
  // 2. Явный ID из запроса (ЛК)
  // 3. Текст из подписи к фото (caption — где ФИО)
  // 4. Имя из Gemini OCR
  let searchQuery = studentId || update.studentId || '';

  if (!searchQuery) {
    if (caption) {
      // Если подпись есть (например, "Иванова Анна") — берем её в первую очередь!
      searchQuery = caption;
    } else {
      // Если подписи к фото нет — берем то, что вытащил OCR
      searchQuery = isMedical 
        ? (ocrData?.childName || ocrData?.child_name || '') 
        : (ocrData?.payerName || ocrData?.studentName || '');
    }
  }

  const payload: Record<string, any> = {
    action: targetAction,
    studentId: studentId || update.studentId || null,
    studentName: searchQuery, // Передаем явным полем для GAS
    searchQuery: searchQuery,
    rawCaption: caption,
    fileUrl: fileUrl,
    source: msg ? 'TELEGRAM' : 'LK',
    telegram_id: chatId,
    chat_id: chatId,
    thread_id: threadId,
    topic_id: threadId,
    message_id: msg?.message_id || null
  };

  if (isMedical) {
    payload.child_name = ocrData?.childName || ocrData?.child_name || searchQuery;
    payload.startDate = ocrData?.startDate || ocrData?.start_date || update.startDate || null;
    payload.endDate = ocrData?.endDate || ocrData?.end_date || update.endDate || null;
    payload.reason = ocrData?.reason || ocrData?.diagnosis || caption || 'Справка';
    payload.days = ocrData?.days || null;
  } else {
    payload.amount = ocrData?.amount || update.amount || null;
    payload.date = ocrData?.date || update.date || null;
  }

  console.log(`[PAYLOAD OUT] Action: ${targetAction} | Target Student: ${searchQuery}`);

  const result = await callAppsScript(googleScriptUrl, payload);

    // Ошибка поиска в базе
    if (result && (result.status === 'error' || result.ok === false || result.error)) {
      const errorMsg = result?.message || result?.error || 'Ученик не найден в базе.';
      
      if (chatId && msg) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            ...(threadId ? { message_thread_id: Number(threadId) } : {}),
            ...(msg?.message_id ? { reply_to_message_id: msg.message_id } : {}),
            text: `⚠️ <b>Ошибка обработки (${isMedical ? 'Справка' : 'Чек'}):</b> ${errorMsg}`,
            parse_mode: 'HTML'
          })
        });
      }
      return NextResponse.json({ ok: true, handled_error: errorMsg, ocrData }, { headers: corsHeaders });
    }

    // Успешный ответ
    if (result && (result.status === 'success' || result.ok)) {
      if (!msg && botToken) {
        const studentName = result.student_name || result.studentName || result.student_id || payload.studentId;
        const displayName = studentName ? `<b>${studentName}</b>` : 'не указан';

        const successText = isMedical 
          ? `🏥 <b>Справка успешно обработана!</b>\n` +
            `👤 Ученик: ${displayName}\n` +
            `📅 Период: <b>${result.startDate || payload.startDate || 'по справке'}</b> по <b>${result.endDate || payload.endDate || '—'}</b>\n` +
            `❄️ Дней продления: <b>${result.days_frozen || result.days || '—'}</b>`
          : `💳 <b>Оплата принята!</b>\n` +
            `👤 Ученик: ${displayName}\n` +
            `💰 Сумма: <b>${result.amount || payload.amount || '—'} ₽</b>`;

        const targetGroupChatId = result.chat_id || process.env.TELEGRAM_ADMIN_GROUP_ID;
        const envTopicId = isMedical ? process.env.TELEGRAM_MEDICAL_TOPIC_ID : process.env.TELEGRAM_PAYMENTS_TOPIC_ID;
        const targetTopicId = result.topic_id || envTopicId;

        if (targetGroupChatId) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetGroupChatId,
              ...(targetTopicId ? { message_thread_id: Number(targetTopicId) } : {}),
              text: successText,
              parse_mode: 'HTML'
            })
          }).catch(e => console.error('Error sending message from LK:', e));
        }
      }

      return NextResponse.json({ ok: true, result, ocrData }, { headers: corsHeaders });
    }
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}

    // ------------------------------------------------------------------------
    // SUB-SECTION 2.2: CALLBACK QUERIES (BUTTON PRESSES)
    // ------------------------------------------------------------------------
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackData = callbackQuery.data || '';
      const message = callbackQuery.message;

      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id })
      }).catch(err => console.error('Error answering callback query immediately:', err));

      if (!message) {
        return NextResponse.json({ ok: true });
      }

      const chatId = message.chat.id;
      const messageId = message.message_id;

      if (callbackData === 'ignore') {
        return NextResponse.json({ ok: true });
      }

// 📌 SECTION: ОБРАБОТКА КНОПОК ЗАМОРОЗКИ (ОДОБРИТЬ / ОТКЛОНИТЬ ИЗ ТЕЛЕГРАМ)
if (callbackData.startsWith('freeze_approve:') || callbackData.startsWith('freeze_reject:')) {
  const isApprove = callbackData.startsWith('freeze_approve:');
  const freezeId = callbackData.split(':')[1];
  const statusText = isApprove ? 'Заморожен' : 'Активен';
  const originalText = message.text || '';

  // 1. Извлекаем Телефон (ищет "Телефон: ...")
  const phoneMatch = originalText.match(/Телефон:\s*([^\n]+)/i);
  const extractedPhone = phoneMatch ? phoneMatch[1].trim() : '';

  // 2. Извлекаем Имя ученика (ищет "Ученик:" или "Ученик/Лид:")
  const nameMatch = originalText.match(/(?:Ученик|Ученик\/Лид):\s*([^\n]+)/i);
  const extractedName = nameMatch ? nameMatch[1].trim() : '';

  // 3. Извлекаем даты (ищет "Период: с XX по YY")
  const dateMatch = originalText.match(/Период:\s*с\s*([^\s]+)\s*по\s*([^\n\s]+)/i);
  const startDate = isApprove && dateMatch ? dateMatch[1] : '';
  const endDate = isApprove && dateMatch ? dateMatch[2] : '';

  // Передаем то, по чему 100% найдется ученик: телефон или имя
  const targetSearch = extractedPhone || extractedName || freezeId;

  console.log(' Telegram Freeze Callback Data:', {
    targetSearch,
    extractedPhone,
    extractedName,
    startDate,
    endDate,
    statusText
  });

  // 4. Отправляем запрос в Google Apps Script
  if (googleScriptUrl) {
    const res = await callAppsScript(googleScriptUrl, {
      action: 'update_freeze_status',
      phone: targetSearch,
      status: statusText,
      startDate: startDate,
      endDate: endDate
    });
    console.log(' GAS Update Status Result:', res);
  }

  // 5. Обновляем плашку сообщения в Telegram
  const updatedStatusHeader = isApprove
    ? `✅ <b>ЗАМОРОЗКА ОДОБРЕНА</b>\n\n`
    : `❌ <b>ЗАМОРОЗКА ОТКЛОНЕНА</b>\n\n`;

  await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: updatedStatusHeader + originalText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    })
  });

  return NextResponse.json({ ok: true });
}

      // 📌 SECTION 2.3: INFO MENU HANDLERS
      if (callbackData.startsWith('info_')) {
        const infoType = callbackData.replace('info_', '');

        if (infoType === 'main_menu') {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: 'ℹ️ <b>Главное меню информации:</b>\n\nВыберите интересующий вас раздел:',
              parse_mode: 'HTML',
              reply_markup: getInfoMenuKeyboard()
            })
          });
        } else if (INFO_MATERIALS[infoType]) {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: INFO_MATERIALS[infoType],
              parse_mode: 'HTML',
              reply_markup: getBackToMenuKeyboard()
            })
          });
        }

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
        return NextResponse.json({ ok: true });
      }

      // 📌 SECTION 3: PARENT USER FLOW (CALLBACKS)
      if (callbackData.startsWith('pick_parent_date:')) {
        const [, leadId, selectedDate, dayOfWeek] = callbackData.split(':');
        let availableGroups = [];

        if (googleScriptUrl) {
          const data = await callAppsScript(googleScriptUrl, {
            action: 'get_groups_by_date',
            date: selectedDate,
            day_of_week: dayOfWeek,
            lead_id: leadId,
          });
          if (data && data.groups) {
            availableGroups = data.groups;
          }
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        if (availableGroups.length === 0) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
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
              chat_id: chatId,
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
        return NextResponse.json({ ok: true });
      }

      if (callbackData.startsWith('confirm_parent_group:')) {
        const [, leadId, selectedDate, groupId] = callbackData.split(':');
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

        let leadDetails: any = null;

        if (googleScriptUrl) {
          const data = await callAppsScript(googleScriptUrl, {
            action: 'assign_first_lesson',
            lead_id: leadId,
            group_id: groupId,
            first_lesson_date: selectedDate,
            by_parent: true
          });
          if (data && data.lead) {
            leadDetails = data.lead;
          }
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        // 1. РЕДАКТИРУЕМ ИСХОДНУЮ КАРТОЧКУ В ТОПИКЕ "НОВЫЕ ЗАЯВКИ"
        const cardMessageId = leadDetails?.tg_message_id;
        const leadsTopicId = process.env.TELEGRAM_LEADS_TOPIC_ID || '1';

        if (adminChatId && cardMessageId) {
          const updatedCardText = 
            `🔥 <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ</b>\n\n` +
            `🆔 <b>ID Заявки:</b> <code>${leadId}</code>\n` +
            `👤 <b>Родитель:</b> ${leadDetails?.parentName || '—'}\n` +
            `👶 <b>Ребенок:</b> ${leadDetails?.childName || '—'}\n` +
            `📞 <b>Телефон:</b> ${leadDetails?.phone || '—'}\n` +
            `🏙 <b>Город:</b> ${leadDetails?.city || '—'}\n\n` +
            `✅ <b>СТАТУС:</b> Записан на 1-е занятие\n` +
            `📅 <b>Дата:</b> <code>${formattedDisplayDate}</code>\n` +
            `🩰 <b>Группа:</b> <code>${groupId}</code>\n` +
            `✨ <i>Родитель записался сам через бота</i>`;

          const editPayload: any = {
            chat_id: adminChatId,
            message_id: Number(cardMessageId),
            text: updatedCardText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
          };

          if (leadsTopicId) {
            editPayload.message_thread_id = Number(leadsTopicId);
          }

          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editPayload)
          }).catch(err => console.error('Error editing original admin card:', err));
        }

        // 2. ОТПРАВЛЯЕМ НОВОЕ УВЕДОМЛЕНИЕ В ТОПИК 1-ГО ЗАНЯТИЯ
        if (adminChatId) {
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
              chat_id: adminChatId,
              message_thread_id: Number(firstLessonTopicId),
              text: topicMessageText,
              parse_mode: 'HTML'
            })
          }).catch(err => console.error('Error sending to first lesson topic:', err));
        }

        // 3. ОТВЕЧАЕМ РОДИТЕЛЮ И ПОКАЗЫВАЕМ МЕНЮ
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Вы успешно записаны!' })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎉 <b>Поздравляем! Вы успешно записаны!</b>\n\n📅 Дата занятия: <b>${formattedDisplayDate}</b>\n\nЖдем вас в нашей студии!`,
            parse_mode: 'HTML'
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: 'ℹ️ <b>Полезная информация перед первым занятием:</b>\n\nВыберите интересующий вас раздел ниже:',
            parse_mode: 'HTML',
            reply_markup: getInfoMenuKeyboard()
          })
        });

        return NextResponse.json({ ok: true });
      }

      // 📌 SECTION 3.1: TRIAL CONFIRMATION HANDLERS
      if (callbackData.startsWith('confirm_trial_yes:')) {
        const leadId = callbackData.split(':')[1];
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

        let leadDetails: any = null;

        if (googleScriptUrl) {
          const data: any = await callAppsScript(googleScriptUrl, {
            action: 'confirm_attendance',
            lead_id: leadId,
            is_confirmed: true
          }).catch(err => console.error('Apps Script error:', err));

          if (data && data.ok) {
            leadDetails = data.lead || data.result || data;
          }
        }

        const parentName = leadDetails?.parent_name || leadDetails?.parentName || leadDetails?.['Имя родителя'] || 'Не указано';
        const childName = leadDetails?.child_name || leadDetails?.childName || leadDetails?.['Имя ребенка'] || 'Не указано';
        const phone = leadDetails?.phone || leadDetails?.['Телефон'] || 'Не указано';
        const city = leadDetails?.city || leadDetails?.['Город'] || 'Не указано';
        const groupName = leadDetails?.group_name || leadDetails?.groupName || leadDetails?.['Группа'] || '—';
        const lessonTime = leadDetails?.lesson_time || leadDetails?.lessonTime || leadDetails?.['Время'] || '—';
        
        const rawAdminMsgId = leadDetails?.tg_message_id || leadDetails?.tgMessageId || leadDetails?.adminMessageId || leadDetails?.admin_message_id;
        const adminMessageId = rawAdminMsgId && !isNaN(Number(rawAdminMsgId)) && Number(rawAdminMsgId) > 0 ? Number(rawAdminMsgId) : null;

        if (adminChatId) {
          const confirmMessageText = 
            `✅ <b>РОДИТЕЛЬ ПОДТВЕРДИЛ ПРИСУТСТВИЕ (ЧЕРЕЗ БОТА)</b>\n\n` +
            `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
            `👤 <b>Родитель:</b> ${parentName}\n` +
            `👶 <b>Ребенок:</b> ${childName}\n` +
            `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
            `🏙 <b>Город:</b> ${city}\n` +
            (groupName !== '—' ? `🩰 <b>Группа:</b> ${groupName}\n` : '') +
            (lessonTime !== '—' ? `⏰ <b>Время:</b> ${lessonTime}\n` : '');

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminChatId,
              message_thread_id: 74,
              text: confirmMessageText,
              parse_mode: 'HTML'
            })
          }).catch(err => console.error('Error sending to Topic 74:', err));

          if (adminMessageId) {
            const topic3UpdateText = 
              `✅ <b>ПОДТВЕРЖДЕНО РОДИТЕЛЕМ В БОТЕ</b>\n\n` +
              `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
              `👤 <b>Родитель:</b> ${parentName}\n` +
              `👶 <b>Ребенок:</b> ${childName}\n` +
              `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
              `🏙 <b>Город:</b> ${city}`;

            await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: adminChatId,
                message_id: adminMessageId,
                text: topic3UpdateText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            }).catch(err => console.error('Error updating Topic 3 message:', err));
          }
        }

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: `🎉 <b>Отлично, ждем вас сегодня на занятии!</b>\n\nПожалуйста, приходите за 10–15 минут до начала.`,
            parse_mode: 'HTML',
            reply_markup: getInfoMenuKeyboard()
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Спасибо за подтверждение!' })
        });

        return NextResponse.json({ ok: true });
      }

      if (callbackData.startsWith('confirm_trial_no:')) {
        const leadId = callbackData.split(':')[1];
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

        let leadDetails: any = null;

        if (googleScriptUrl) {
          const data: any = await callAppsScript(googleScriptUrl, {
            action: 'confirm_attendance',
            lead_id: leadId,
            is_confirmed: false
          }).catch(err => console.error('Apps Script error:', err));

          if (data && data.ok) {
            leadDetails = data.lead || data.result || data;
          }
        }

        const parentName = leadDetails?.parent_name || leadDetails?.parentName || leadDetails?.['Имя родителя'] || 'Не указано';
        const childName = leadDetails?.child_name || leadDetails?.childName || leadDetails?.['Имя ребенка'] || 'Не указано';
        const phone = leadDetails?.phone || leadDetails?.['Телефон'] || 'Не указано';
        const city = leadDetails?.city || leadDetails?.['Город'] || 'Не указано';
        
        const rawAdminMsgId = leadDetails?.tg_message_id || leadDetails?.tgMessageId || leadDetails?.adminMessageId || leadDetails?.admin_message_id;
        const adminMessageId = rawAdminMsgId && !isNaN(Number(rawAdminMsgId)) && Number(rawAdminMsgId) > 0 ? Number(rawAdminMsgId) : null;

        if (adminChatId) {
          const alarmMessageText = 
            `🚨 <b>ОТМЕНА/ПЕРЕНОС РОДИТЕЛЕМ (ЧЕРЕЗ БОТА)</b>\n\n` +
            `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
            `👤 <b>Родитель:</b> ${parentName}\n` +
            `👶 <b>Ребенок:</b> ${childName}\n` +
            `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
            `🏙 <b>Город:</b> ${city}\n\n` +
            `⚠️ <i>Родитель сообщил в боте, что прийти не сможет. Свяжитесь для уточнения переноса!</i>`;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminChatId,
              message_thread_id: 6,
              text: alarmMessageText,
              parse_mode: 'HTML'
            })
          }).catch(err => console.error('Error sending to Topic 6:', err));

          if (adminMessageId) {
            const topic3UpdateText = 
              `🚨 <b>ОТМЕНА РОДИТЕЛЕМ В БОТЕ</b>\n\n` +
              `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
              `👤 <b>Родитель:</b> ${parentName}\n` +
              `👶 <b>Ребенок:</b> ${childName}\n` +
              `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
              `🏙 <b>Город:</b> ${city}`;

            await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: adminChatId,
                message_id: adminMessageId,
                text: topic3UpdateText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            }).catch(err => console.error('Error updating Topic 3 message:', err));
          }
        }

        const daysKeyboard = await generateUpcomingDays(leadId, googleScriptUrl, 'parent');

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: `Очень жаль, что вы не сможете прийти сегодня! 😔\n\nДавайте перенесем занятие на другой удобный для вас день:`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: daysKeyboard }
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });

        return NextResponse.json({ ok: true });
      }

      if (callbackData.startsWith('admin_confirm:') || callbackData.startsWith('admin_cancel:')) {
        const isAdminConfirm = callbackData.startsWith('admin_confirm:');
        const leadId = callbackData.split(':')[1];
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

        const originalText = callbackQuery.message?.text || '';

        if (googleScriptUrl) {
          callAppsScript(googleScriptUrl, {
            action: 'confirm_attendance',
            lead_id: leadId,
            is_confirmed: isAdminConfirm
          }).catch(err => console.error('Apps Script update error:', err));
        }

        if (adminChatId) {
          const targetTopicId = isAdminConfirm ? 74 : 6;
          const statusHeader = isAdminConfirm 
            ? `✅ <b>ПОДТВЕРЖДЕНО (ОТМЕЧЕНО АДМИНОМ)</b>\n\n`
            : `🚨 <b>ОТМЕНА/ПЕРЕНОС (ОТМЕЧЕНО АДМИНОМ)</b>\n\n`;

          const noticeText = statusHeader + originalText;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminChatId,
              message_thread_id: targetTopicId,
              text: noticeText,
              parse_mode: 'HTML'
            })
          }).catch(err => console.error(`Error sending to Topic ${targetTopicId}:`, err));
        }

        const updatedTopic3Text = 
          (isAdminConfirm ? `✅ <b>ПОДТВЕРЖДЕНО АДМИНИСТРАТОРОМ</b>\n\n` : `🚨 <b>ОТМЕНЕНО / ПЕРЕНОС (АДМИН)</b>\n\n`) + 
          originalText;

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: updatedTopic3Text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Статус обновлен!' })
        });

        return NextResponse.json({ ok: true });
      }

      if (callbackData.startsWith('resched_day_parent:') || callbackData.startsWith('resched_day_admin:')) {
        const parts = callbackData.split(':');
        const isParent = callbackData.startsWith('resched_day_parent:');
        const leadId = parts[1];
        const newDate = parts[2];

        if (googleScriptUrl) {
          await callAppsScript(googleScriptUrl, {
            action: 'reschedule_trial',
            lead_id: leadId,
            new_date: newDate,
            rescheduled_by: isParent ? 'parent' : 'admin'
          });
        }

        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

        if (adminChatId) {
          const rescheduleNoticeText = 
            `📅 <b>ПЕРЕНОС ПРОБНОГО ЗАНЯТИЯ</b>\n\n` +
            `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
            `📆 <b>Новая дата:</b> <code>${newDate}</code>\n` +
            `👤 <b>Кем перенесено:</b> ${isParent ? 'Родитель (через бота)' : 'Администратор'}`;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminChatId,
              message_thread_id: 6,
              text: rescheduleNoticeText,
              parse_mode: 'HTML'
            })
          }).catch(err => console.error('Error sending reschedule to Topic 6:', err));
        }

        const userConfirmationText = isParent
          ? `📅 <b>Спасибо! Ваше занятие перенесено на ${newDate}.</b>\n\nМы отправим вам напоминание накануне!`
          : `✅ <b>Занятие успешно перенесено на ${newDate}</b> (ID: <code>${leadId}</code>)`;

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: userConfirmationText,
            parse_mode: 'HTML',
            reply_markup: isParent ? getInfoMenuKeyboard() : { inline_keyboard: [] }
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Перенос оформлен!' })
        });

        return NextResponse.json({ ok: true });
      }

      // 📌 SECTION 4: ADMIN WORKSPACE FLOW
      if (callbackData.startsWith('assign_lesson:')) {
        const leadId = callbackData.split(':')[1];
        
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
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: daysKeyboard }
          })
        });

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Выберите дату для лида' })
        });
        return NextResponse.json({ ok: true });
      }

      if (callbackData.startsWith('pick_admin_date:')) {
        const [, leadId, selectedDate, dayOfWeek] = callbackData.split(':');
        let availableGroups = [];

        if (googleScriptUrl) {
          const data = await callAppsScript(googleScriptUrl, {
            action: 'get_groups_by_date',
            date: selectedDate,
            day_of_week: dayOfWeek,
            lead_id: leadId,
          });
          if (data && data.groups) {
            availableGroups = data.groups;
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
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: groupButtons }
            })
          });

          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id, text: `Дата ${formattedDisplayDate}. Выберите группу:` })
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (callbackData.startsWith('confirm_admin_group:')) {
        const [, leadId, selectedDate, groupId] = callbackData.split(':');

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
          })
        });

        let success = false;
        let leadDetails: any = null;

        if (googleScriptUrl) {
          const data = await callAppsScript(googleScriptUrl, {
            action: 'assign_first_lesson',
            lead_id: leadId,
            group_id: groupId,
            first_lesson_date: selectedDate,
            by_parent: false
          });
          if (data && (data.status === 'success' || data.ok)) {
            success = true;
            leadDetails = data.lead;
          }
        } else {
          success = true;
        }

        const [year, month, day] = selectedDate.split('-');
        const formattedDisplayDate = `${day}.${month}.${year}`;

        const messageText = ('text' in message) ? message.text || '' : '';

        if (success) {
          const updatedText = `${messageText}\n\n✅ <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ (Администратором)</b>\n📅 Дата: <b>${formattedDisplayDate}</b>\n🆔 Группа: <code>${groupId}</code>`;

          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: updatedText,
              parse_mode: 'HTML',
            })
          });

          const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
          if (adminChatId) {
            const topicMessageText = 
              `🎉 <b>ЗАПИСЬ НА 1-Е ЗАНЯТИЕ (Записал админ)</b>\n\n` +
              `🆔 <b>ID Лида:</b> <code>${leadId}</code>\n` +
              `📅 <b>Дата занятия:</b> <code>${formattedDisplayDate}</code>\n` +
              `🩰 <b>Группа:</b> <code>${groupId}</code>\n\n` +
              `📋 <b>Данные заявки:</b>\n` +
              `👤 <b>Родитель:</b> ${leadDetails?.parentName || '—'}\n` +
              `👶 <b>Ребенок:</b> ${leadDetails?.childName || '—'}\n` +
              `📞 <b>Телефон:</b> ${leadDetails?.phone || '—'}\n` +
              `🏙 <b>Город:</b> ${leadDetails?.city || '—'}`;

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: adminChatId,
                message_thread_id: Number(firstLessonTopicId),
                text: topicMessageText,
                parse_mode: 'HTML'
              })
            }).catch(err => console.error('Error sending to first lesson topic:', err));
          }

          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id,
              text: `Записано на ${formattedDisplayDate}`
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id,
              text: 'Ошибка при сохранении данных в таблицу!',
              show_alert: true
            })
          });
        }
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook Handler Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}