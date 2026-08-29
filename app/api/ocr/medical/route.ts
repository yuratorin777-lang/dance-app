import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

const medicalSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    child_name: { type: Type.STRING, description: 'ФИО ребенка / пациента в именительном падеже' },
    start_date: { type: Type.STRING, description: 'Дата начала освобождения/болезни (ГГГГ-ММ-ДД)' },
    end_date: { type: Type.STRING, description: 'Дата окончания освобождения/болезни (ГГГГ-ММ-ДД)' },
    diagnosis: { type: Type.STRING, description: 'Диагноз или причина освобождения (при наличии)' },
    is_valid: { type: Type.BOOLEAN, description: 'Является ли документ официальной медицинской справкой' },
  },
  required: ['child_name', 'start_date', 'end_date', 'is_valid'],
};

export async function analyzeMedicalDoc(imageBase64: string, mimeType = 'image/jpeg', caption = '') {
  // Универсальная очистка base64 от любого MIME-префикса
  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
        },
      },
      {
        text: `Распознай медицинскую справку или заявление. Извлеки ФИО ребенка и точные даты периода болезни/освобождения (с какого по какое число).

КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО ДЛЯ ИМЕНИ РЕБЕНКА (child_name):
В справках имя почти всегда написано в ДАТЕЛЬНОМ или РОДИТЕЛЬНОМ падеже (например: "Миляевой Дарине", "Иванову Пётру", "Сидоровой Марии").
Ты ОБЯЗАН автоматически переводить ФИО ребенка в ИМЕНИТЕЛЬНЫЙ ПАДЕЖ (Кто? Что?)!
Примеры:
- "Миляевой Дарине" -> "Миляева Дарина"
- "Миляевой Дарины" -> "Миляева Дарина"
- "Иванову Петру" -> "Иванов Петр"
- "Сидоровой Марии" -> "Сидорова Мария"

Дополнительно тебе дана подпись к справке от пользователя: "${caption}".
Если из документа сложно понять ФИО, используй имя из подписи.
Формат ответа — строго по JSON schema.`,
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: medicalSchema,
    },
  });

  const parsed = JSON.parse(response.text || '{}');

  // Нормализация ключей для совместимости с разными сервисами
  return {
    ...parsed,
    startDate: parsed.start_date || parsed.startDate || null,
    endDate: parsed.end_date || parsed.endDate || null,
    childName: parsed.child_name || parsed.childName || null,
    reason: parsed.diagnosis || parsed.reason || 'Заболевание'
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageBase64, mimeType = 'image/jpeg', studentId, caption = '' } = body;

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, message: 'Отсутствует изображение справки' },
        { status: 400 }
      );
    }

    const extractedData = await analyzeMedicalDoc(imageBase64, mimeType, caption);

    if (!extractedData.is_valid) {
      return NextResponse.json({
        success: false,
        message: 'Загруженный документ не распознан как медицинская справка',
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
          action: 'APPLY_FREEZE',
          studentId: studentId || null,
          searchQuery: extractedData.childName || extractedData.child_name || caption || '',
          startDate: extractedData.startDate,
          endDate: extractedData.endDate,
          start_date: extractedData.startDate,
          end_date: extractedData.endDate,
          reason: extractedData.reason || extractedData.diagnosis || 'Справка',
          source: 'DIRECT_API'
        }),
      });

      gasResult = await gasResponse.json();
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (gasResult && gasResult.chat_id && gasResult.topic_medical_id && botToken) {
      const tgText = 
        `🏥 <b>МЕДИЦИНСКАЯ СПРАВКА / ЗАМОРОЗКА</b>\n\n` +
        `👤 <b>Ученик:</b> ${gasResult.student_name || extractedData.childName || 'Не указан'}\n` +
        `📅 <b>Период:</b> с ${extractedData.startDate} по ${extractedData.endDate}\n` +
        `❄️ <b>Дней заморозки:</b> ${gasResult.days_frozen || '—'}\n` +
        `📝 <b>Диагноз/Причина:</b> ${extractedData.reason || 'Не указан'}`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: gasResult.chat_id,
          message_thread_id: Number(gasResult.topic_medical_id),
          text: tgText,
          parse_mode: 'HTML',
        }),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Справка принята, период заморозки зафиксирован',
      ocr: extractedData,
      gasResponse: gasResult,
    });
  } catch (error: any) {
    console.error('OCR Medical Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Ошибка обработки справки' },
      { status: 500 }
    );
  }
}