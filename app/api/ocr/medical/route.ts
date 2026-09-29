import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import sharp from 'sharp';

export const maxDuration = 30;

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

// Точная схема из ЛК
const medicalSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    child_name: { 
      type: Type.STRING, 
      description: 'ФИО ребенка в именительном падеже' 
    },
    start_date: { 
      type: Type.STRING, 
      description: 'Дата начала болезни YYYY-MM-DD из фразы "с [число]"' 
    },
    end_date: { 
      type: Type.STRING, 
      description: 'Дата окончания болезни YYYY-MM-DD из фразы "по [число]"' 
    },
    diagnosis: { 
      type: Type.STRING, 
      description: 'Краткий диагноз (например: ОРВИ, Грипп, Заболевание). Читай короткое вписанное слово сразу после слова "Перенес".' 
    },
    is_valid: { 
      type: Type.BOOLEAN, 
      description: 'Является ли документ медицинской справкой' 
    },
  },
  required: ['child_name', 'start_date', 'end_date', 'diagnosis', 'is_valid'],
};

export async function classifyDocumentType(imageBase64: string, mimeType = 'image/jpeg', caption = ''): Promise<'MEDICAL' | 'RECEIPT'> {
  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

  try {
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
          text: `Посмотри на изображение/документ и подпись к нему: "${caption}".
Определи тип документа:

1. "RECEIPT" — банковский чек, квитанция, сбербанк онлайн, перевод, чек об оплате.
2. "MEDICAL" — медицинская справка, больничный лист, справка от врача, диагноз, освобождение от занятий, документ с печатями поликлиники.

Верни СТРОГО JSON: {"document_type": "RECEIPT"} или {"document_type": "MEDICAL"}`,
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '';
    const cleanJson = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    return parsed.document_type === 'MEDICAL' ? 'MEDICAL' : 'RECEIPT';
  } catch (err) {
    console.error('Classification error:', err);
    return 'RECEIPT';
  }
}

// Auto-rotate для вертикальных изображений из Telegram
async function ensureHorizontalImage(imageBase64: string): Promise<string> {
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (metadata.height && metadata.width && metadata.height > metadata.width) {
      const rotatedBuffer = await image.rotate(90).toBuffer();
      return rotatedBuffer.toString('base64');
    }
    return imageBase64;
  } catch (err) {
    console.error('Ошибка при повороте изображения:', err);
    return imageBase64;
  }
}

export async function analyzeMedicalDoc(imageBase64: string, mimeType = 'image/jpeg', caption = '') {
  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

  const processedBase64 = mimeType.includes('pdf') 
    ? cleanBase64 
    : await ensureHorizontalImage(cleanBase64);

  // Точный промпт из ЛК
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        inlineData: {
          mimeType: mimeType,
          data: processedBase64,
        },
      },
      {
        text: `Проанализируй медицинскую справку.

1. Период болезни находится в строке: "с «[день1]» 09 2026 по «[день2]» 09 2026".
   - start_date: дата из "с [день1]" (например: 22).
   - end_date: дата из "по [день2]" (например: 25).

2. Игнорируй даты "28" внизу бланка (дата допуска и дата выдачи).
3. Переведи ФИО в Именительный падеж ("Новиковой Софье" -> "Новикова Софья").
4. Извлеки диагноз (например: "ОРВИ").

Год: 2026. Подпись: "${caption}".`,
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: medicalSchema,
      temperature: 0.1,
    },
  });

  // Получаем чистый ответ от Gemini (как в ЛК)
  const parsed = JSON.parse(response.text || '{}');

  let startDate = parsed.start_date || null;
  let endDate = parsed.end_date || null;

  // 🛡️ Защита порядка дат из ЛК (без искусственной нормализации)
  if (startDate && endDate) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s > e) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }
  }

  // Расчет количества дней для передачи в GAS
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
    child_name: parsed.child_name || null,
    childName: parsed.child_name || null,
    start_date: startDate,
    end_date: endDate,
    startDate: startDate,
    endDate: endDate,
    days: days > 0 ? days : 1,
    reason: parsed.diagnosis || 'Заболевание',
    diagnosis: parsed.diagnosis || 'Заболевание',
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
    const gasUrl =
      process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL ||
      process.env.GOOGLE_SCRIPT_WEB_APP_URL;

    if (gasUrl) {
      const gasResponse = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPLY_FREEZE',
          studentId: studentId || null,
          searchQuery: extractedData.childName || caption || '',
          childName: extractedData.childName,
          startDate: extractedData.startDate,
          endDate: extractedData.endDate,
          days: extractedData.days,
          reason: extractedData.reason || 'Справка из ТГ',
          source: 'DIRECT_API'
        }),
      });

      const text = await gasResponse.text();
      try {
        gasResult = JSON.parse(text);
      } catch (e) {
        gasResult = { status: 'success', raw: text };
      }
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