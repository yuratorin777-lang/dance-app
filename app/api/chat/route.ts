import { NextRequest, NextResponse } from 'next/server';
import knowledgeBase from '@/data/knowledgebase.json';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { reply: "[Ошибка]: GROQ_API_KEY не найден в .env.local" },
        { status: 200 }
      );
    }

    const systemPrompt = `
Ты — вежливый, заботливый и энергичный ИИ-Консультант школы детских танцев "Baby Dance".
Твоя цель — помочь родителю, ответить на его вопрос и мягко пригласить записаться на 1-е пробное занятие.

ОТВЕЧАЙ СТРОГО НА ОСНОВЕ ЭТОЙ БАЗЫ ЗНАНИЙ:
${JSON.stringify(knowledgeBase, null, 2)}

ПРАВИЛА ОБЩЕНИЯ:
1. Отвечай живым языком, кратко (2-3 предложения), дружелюбно и емко.
2. Не пересказывай всю базу разом — давай ровно тот ответ, о котором спросил родитель.
3. Если информации нет в базе знаний, вежливо скажи, что уточнишь у администратора.
4. В конце ответа ненавязчиво предложи заполнить форму записи на этой странице.
`;

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    ];

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: formattedMessages,
        temperature: 0.4,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      return NextResponse.json(
        { reply: `[Ошибка Groq API ${response.status}]: ${errData?.error?.message || response.statusText}` },
        { status: 200 }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Извините, не удалось сформировать ответ.";

    return NextResponse.json({ reply });

  } catch (error: any) {
    return NextResponse.json(
      { reply: `[Ошибка сервера]: ${error.message}` },
      { status: 200 }
    );
  }
}