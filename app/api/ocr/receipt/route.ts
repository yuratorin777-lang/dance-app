import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';

// Инициализация Gemini API с ключом из переменной окружения
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Схема ответа от Gemini
const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    amount: { type: Type.NUMBER, description: 'Сумма платежа в рублях' },
    timestamp: { type: Type.STRING, description: 'Дата и время операции (например, 2026-08-22 14:30)' },
    sender_name: { type: Type.STRING, description: 'ФИО или имя отправителя, если указано' },
    status: { type: Type.STRING, description: 'Статус платежа: SUCCESS, PENDING или FAILED' },
    payment_type: { 
      type: Type.STRING, 
      description: 'Тип оплаты: "TRIAL" (пробное), "SUBSCRIPTION" (абонемент), "SINGLE" (разовое) или "UNKNOWN"' 
    },
  },
  required: ['amount', 'status'],
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageBase64, mimeType = 'image/jpeg', studentId, parentPhone } = body;

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, message: 'Отсутствует изображение чека (imageBase64)' },
        { status: 400 }
      );
    }

    // 1. Отправка запроса в Gemini 2.5 Flash
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
          },
        },
        {
          text: 'Внимательно распознай банковский чек. Извлеки сумму, дату и время операции, имя отправителя и статус перевода. Отвечай строго по JSON schema.',
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
      },
    });

    const extractedData = JSON.parse(response.text || '{}');

    // Проверка статуса распознанного чека
    if (extractedData.status !== 'SUCCESS' && extractedData.status !== 'УСПЕШНО') {
      return NextResponse.json({
        success: false,
        message: 'Чек не подтвержден или находится в обработке',
        data: extractedData,
      });
    }

    // 2. Отправка данных в Google Apps Script (GAS)
    let gasResult: any = null;
    const gasUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL; // <-- ИСПРАВЛЕННОЕ ИМЯ ПЕРЕМЕННОЙ

    if (gasUrl) {
      const gasResponse = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PROCESS_RECEIPT',
          studentId: studentId || null,
          parentPhone: parentPhone || null,
          amount: extractedData.amount,
          timestamp: extractedData.timestamp,
          senderName: extractedData.sender_name,
          paymentType: extractedData.payment_type,
        }),
      });

      gasResult = await gasResponse.json();
    }

    // 3. Отправка карточки оплаты в Telegram (в topic_payments_id или общий чат группы)
    if (gasResult && gasResult.chat_id && process.env.TELEGRAM_BOT_TOKEN) {
      const tgText = 
        `💳 *ПОСТУПИЛА ОПЛАТА ПО ЧЕКУ*\n\n` +
        `💰 *Сумма:* ${extractedData.amount || 0} ₽\n` +
        `👤 *Отправитель:* ${extractedData.sender_name || 'Не указан'}\n` +
        `🕒 *Дата/Время:* ${extractedData.timestamp || '—'}\n` +
        `➕ *Начислено занятий:* ${gasResult.classes_added || 0}\n` +
        `🆔 *ID Платежа:* \`${gasResult.payment_id || '—'}\``;

      const payload: Record<string, any> = {
        chat_id: gasResult.chat_id,
        text: tgText,
        parse_mode: 'Markdown',
      };

      // Если в GAS передается ID топика оплат — отправляем в топик
      if (gasResult.topic_payments_id) {
        payload.message_thread_id = gasResult.topic_payments_id;
      }

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Чек успешно распознан и обработан',
      ocr: extractedData,
      gasResponse: gasResult,
    });
  } catch (error: any) {
    console.error('OCR Receipt Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Ошибка обработки чека' },
      { status: 500 }
    );
  }
}