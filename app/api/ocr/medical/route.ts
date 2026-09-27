import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import sharp from 'sharp';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

const medicalSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    child_name: { 
      type: Type.STRING, 
      description: 'ФИО ребенка / пациента в именительном падеже' 
    },
    start_date: { 
      type: Type.STRING, 
      description: 'Дата начала болезни в формате YYYY-MM-DD (например: 2026-09-12)' 
    },
    end_date: { 
      type: Type.STRING, 
      description: 'Дата окончания болезни в формате YYYY-MM-DD (например: 2026-09-20)' 
    },
    diagnosis: { 
      type: Type.STRING, 
      description: 'Краткий диагноз (например: ОРВИ). Читай короткое слово сразу после "Перенес"' 
    },
    is_valid: { 
      type: Type.BOOLEAN, 
      description: 'Является ли документ официальной медицинской справкой' 
    },
  },
  required: ['child_name', 'start_date', 'end_date', 'diagnosis', 'is_valid'],
};

// Auto-rotate вертикальных изображений из Telegram
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

  const today = new Date();
  const currentDateISO = today.toISOString().split('T')[0]; // ГГГГ-ММ-ДД
  const currentYear = today.getFullYear();

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
        text: `Проанализируй медицинскую справку из Telegram чата.
Текущая дата сервера: ${currentDateISO}.
Текущий год по умолчанию: ${currentYear}.

Инструкции по извлечению дат:
1. Внимательно найди строку периода болезни: "с «[день1]» [месяц1] [год1] по «[день2]» [месяц2] [год2]".
2. Переведи название месяца (например: "января", "февраля", "сентября", "09") и день в стандартный формат YYYY-MM-DD.
3. Если год в периоде болезни не указан явно, используй год ${currentYear}.
4. В качестве start_date укажи дату начала болезни (YYYY-MM-DD).
5. В качестве end_date укажи дату окончания болезни (YYYY-MM-DD).
6. Игнорируй даты в самом низу бланка (дата выдачи справки, дата допуска к занятиям/врачу).
7. Переведи ФИО ребенка в Именительный падеж (например: "Миляевой Дарине" -> "Миляева Дарина").
8. Если ФИО неразборчиво, используй подпись к фото: "${caption}".
9. Извлеки краткий диагноз (например: "ОРВИ").

Верни результат строго по JSON schema.`,
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: medicalSchema,
      temperature: 0.1,
    },
  });

  const parsed = JSON.parse(response.text || '{}');

  let startDate = parsed.start_date || parsed.startDate || null;
  let endDate = parsed.end_date || parsed.endDate || null;

  // 🛡️ Нормализация и защита формата YYYY-MM-DD
  const normalizeDate = (dStr: string | null) => {
    if (!dStr) return null;
    // Если пришло только число (например "22")
    if (/^\d{1,2}$/.test(dStr.trim())) {
      const day = dStr.trim().padStart(2, '0');
      const month = String(today.getMonth() + 1).padStart(2, '0');
      return `${currentYear}-${month}-${day}`;
    }
    return dStr;
  };

  startDate = normalizeDate(startDate);
  endDate = normalizeDate(endDate);

  // 🛡️ Защита порядка дат
  if (startDate && endDate) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s > e) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }
  }

  // Вычисляем дни
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
    child_name: parsed.child_name || parsed.childName || null,
    childName: parsed.child_name || parsed.childName || null,
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
    const gasUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;

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