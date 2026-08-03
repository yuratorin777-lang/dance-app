import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // Проверяем, нажал ли пользователь/админ инлайн-кнопку
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackData = callbackQuery.data || '';
      const message = callbackQuery.message;

      if (callbackData.startsWith('assign_lesson:')) {
        const leadId = callbackData.split(':')[1];
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;

        // Определяем сегодняшнюю дату
        const today = new Date();
        const formattedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // 1. Отправляем сигнал в Apps Script (ServerAPI.gs)
        if (googleScriptUrl) {
          try {
            await fetch(googleScriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'assign_first_lesson',
                lead_id: leadId,
                first_lesson_date: formattedDate,
              }),
            });
          } catch (err) {
            console.error('Error calling Apps Script:', err);
          }
        }

        // 2. Убираем "часики" с кнопки в Telegram
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: `Лид ${leadId} записан на пробное (${formattedDate})!`,
          }),
        });

        // 3. Обновляем текст сообщения в группе (помечаем, что статус изменился)
        const updatedText = `${message.text}\n\n✅ <b>ЗАПИСАН НА 1-Е ЗАНЯТИЕ</b> (${formattedDate})`;

        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: updatedText,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [], // убираем кнопку после нажатия
            },
          }),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Error in Telegram Webhook:', error);
    return NextResponse.json({ ok: true }); // Telegram ожидает 200 OK
  }
}