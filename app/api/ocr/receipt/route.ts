import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

export async function analyzeReceipt(imageBase64: string, mimeType = 'image/jpeg', caption = '') {
  // Очищаем Base64 от любого префикса (image, application/pdf и т.д.)
  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [
      {
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
        },
      },
      {
        text: `Внимательно распознай банковский чек или документ оплаты. 
Извлеки сумму, дату и время операции. 

Дополнительно тебе дана подпись к чеку от пользователя: "${caption}".
Извлеки из подписи или из чека Имя и Фамилию ребенка (очисти от слов "за", "оплата за", "для" и т.д.).
Верни ФИО в поле sender_name в формате "Фамилия Имя" или "Имя Фамилия".

Отвечай строго по JSON schema.`,
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
    },
  });

  return JSON.parse(response.text || '{}');
}

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

    const extractedData = await analyzeReceipt(imageBase64, mimeType);

    if (extractedData.status !== 'SUCCESS' && extractedData.status !== 'УСПЕШНО') {
      return NextResponse.json({
        success: false,
        message: 'Чек не подтвержден или находится в обработке',
        data: extractedData,
      });
    }

    let gasResult: any = null;
    const gasUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;

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