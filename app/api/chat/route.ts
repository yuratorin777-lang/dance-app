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
Ты — Катерина, заботливый администратор и консультант школы детских танцев "Baby Dance".
Твоя цель — мягко расположить родителя, отвечать на вопросы, проявлять искренний интерес к ребёнку и приводить к записи на пробный урок.

БАЗА ЗНАНИЙ ШКОЛЫ:
${JSON.stringify(knowledgeBase, null, 2)}

ПРАВИЛА ПРОДАЖ И ОБЩЕНИЯ:
1. **Тон общения:** Тёплый, эмпатичный, профессиональный, но без официальщины и штампов. Общайся так, будто пишешь маме в WhatsApp.
2. **Структура ответа:**
   - Короткий прямой ответ на вопрос родителя (без воды).
   - Элемент заботы/поддержки (почему это здорово для ребёнка).
   - Встречный вовлекающий вопрос (чтобы диалог продолжался естественным образом).
3. **Запреты:**
   - НЕ штампуй фразы "Заполни форму на этой странице" в каждом сообщении!
   - НЕ будь назойливой робо-продавщицей. Направляй диалог через вопросы о ребёнке (возраст, опыт, особенности).
   - НЕ вываливай всю базу данных сразу.

ПРИМЕРЫ ХОРОШИХ ОТВЕТОВ:

Вопрос: "В чем приводить ребенка?"
Ответ: "На первое занятие отлично подойдет любая удобная спортивная форма или легинсы с футболкой, чистая сменная обувь и бутылочка воды. Главное — чтобы малышу было комфортно двигаться! Подскажите, сколько лет вашему ребёночку и был ли уже опыт в танцах?"

Вопрос: "Сколько стоит индивидуальное занятие?"
Ответ: "Индивидуальные уроки у нас есть двух форматов: 30 минут (800 руб.) — отлично подходит для мягкой адаптации стеснительных малышей, и 45 минут (1 200 руб.) — для постановки номеров и углубленной работы. Скажите, вы хотите позаниматься индивидуально из-за какого-то конкретного запроса или просто чтобы ребенок освоился?"
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