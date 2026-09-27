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
      description: 'Дата начала болезни ГГГГ-ММ-ДД из фразы "с [число]"' 
    },
    end_date: { 
      type: Type.STRING, 
      description: 'Дата окончания болезни ГГГГ-ММ-ДД из фразы "по [число]"' 
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

  // Поворачиваем картинку, если с телефона пришла вертикальная
  const processedBase64 = mimeType.includes('pdf') 
    ? cleanBase64 
    : await ensureHorizontalImage(cleanBase64);

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash', // 🟢 ИСПРАВЛЕНО: Рабочая модель
    contents: [
      {
        inlineData: {
          mimeType: mimeType,
          data: processedBase64,
        },
      },
      {
        text: `Проанализируй медицинскую справку из Telegram чата.

1. Период болезни находится в строке: "с «[день1]» [месяц1] 2026 по «[день2]» [месяц2] 2026".
   - start_date: дата из "с [день1]".
   - end_date: дата из "по [день2]".

2. Игнорируй даты в самом низу бланка (дата допуска и дата выдачи справки).
3. Переведи ФИО ребенка в Именительный падеж ("Миляевой Дарине" -> "Миляева Дарина").
4. Если ФИО неразборчиво, используй подпись к фото: "${caption}".
5. Извлеки диагноз (например: "ОРВИ").

Год по умолчанию: 2026.
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