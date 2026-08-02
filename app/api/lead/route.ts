import { NextRequest, NextResponse } from 'next/server';
import knowledgeBase from '@/data/knowledgebase.json';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const apiKey = process.env.HF_TOKEN;
    if (!apiKey) {
      return NextResponse.json(
        { reply: "[Ошибка]: HF_TOKEN не найден в .env.local" },
        { status: 200 }
      );
    }

    const systemPrompt = `
Ты — вежливый и энергичный ИИ-Консультант школы танцев.
Твоя задача — отвечать на вопросы родителя и мягко подводить его к записи на 1-е занятие.

ОТВЕЧАЙ СТРОГО ПО БАЗЕ ЗНАНИЙ:
${JSON.stringify(knowledgeBase, null, 2)}

ПРАВИЛА:
1. Отвечай кратко (2-3 предложения) и дружелюбно.
2. Не придумывай того, чего нет в базе знаний.
3. В конце ответа предлагай заполнить форму записи на этой странице.
`;

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    ];

    // Запрос к Hugging Face Inference API
    const response = await fetch("https://api-inference.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-Coder-32B-Instruct",
        messages: formattedMessages,
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { reply: `[Ошибка HF API ${response.status}]: ${errText}` },
        { status: 200 }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Извините, не удалось сформировать ответ.";

    return NextResponse.json({ reply });

  } catch (error: any) {
    console.error("Server Error:", error);
    return NextResponse.json(
      { reply: `[Ошибка сервера]: ${error.message}` },
      { status: 200 }
    );
  }
}