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
        text: `Распознай медицинскую справку или заявление. Извлеки ФИО ребенка и точные даты периода болезни/освобождения (с какого по какое число).

КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО ДЛЯ ИМЕНИ РЕБЕНКА (child_name):
Переводи ФИО ребенка в ИМЕНИТЕЛЬНЫЙ ПАДЕЖ!
Примеры:
- "Миляевой Дарине" -> "Миляева Дарина"
- "Иванову Петру" -> "Иванов Петр"

Дополнительно тебе дана подпись: "${caption}".
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

  const startDate = parsed.start_date || parsed.startDate || null;
  const endDate = parsed.end_date || parsed.endDate || null;

  // Вычисляем количество дней прямо тут для гарантии
  let days = 0;
  if (startDate && endDate) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      days = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }
  }

  return {
    ...parsed,
    startDate,
    endDate,
    days: days > 0 ? days : 1,
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

    let gasResult: any = null;
    const gasUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;

    if (gasUrl) {
      const gasResponse = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPLY_FREEZE', // 🟢 СТРОГО APPLY_FREEZE
          studentId: studentId || null,
          searchQuery: extractedData.childName || caption || '',
          childName: extractedData.childName,
          startDate: extractedData.startDate,
          endDate: extractedData.endDate,
          days: extractedData.days,
          reason: extractedData.reason || 'Справка',
          source: 'DIRECT_API'
        }),
      });

      gasResult = await gasResponse.json();
    }

    return NextResponse.json({
      success: gasResult?.status === 'success',
      message: gasResult?.status === 'success' ? 'Справка принята' : (gasResult?.message || 'Ошибка сохранения'),
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