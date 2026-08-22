import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const medicalSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    child_name: { type: Type.STRING, description: 'ФИО ребенка / пациента' },
    start_date: { type: Type.STRING, description: 'Дата начала освобождения/болезни (ГГГГ-ММ-ДД)' },
    end_date: { type: Type.STRING, description: 'Дата окончания освобождения/болезни (ГГГГ-ММ-ДД)' },
    diagnosis: { type: Type.STRING, description: 'Диагноз или причина освобождения (при наличии)' },
    is_valid: { type: Type.BOOLEAN, description: 'Является ли документ официальной медицинской справкой' },
  },
  required: ['child_name', 'start_date', 'end_date', 'is_valid'],
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageBase64, mimeType = 'image/jpeg', studentId } = body;

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, message: 'Отсутствует изображение справки' },
        { status: 400 }
      );
    }

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
          text: 'Распознай медицинскую справку или заявление. Извлеки ФИО ребенка и точные даты периода болезни/освобождения (с какого по какое число).',
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: medicalSchema,
      },
    });

    const extractedData = JSON.parse(response.text || '{}');

    if (!extractedData.is_valid) {
      return NextResponse.json({
        success: false,
        message: 'Загруженный документ не распознан как медицинская справка',
        data: extractedData,
      });
    }

    // Передаем период заморозки в GAS
    let gasResult = null;
    if (process.env.GAS_WEBHOOK_URL) {
      const gasResponse = await fetch(process.env.GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPLY_FREEZE',
          studentId: studentId || null,
          childName: extractedData.child_name,
          startDate: extractedData.start_date,
          endDate: extractedData.end_date,
          reason: extractedData.diagnosis,
        }),
      });

      gasResult = await gasResponse.json();
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