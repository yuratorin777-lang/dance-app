'use client';

import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Home() {
  // Состояния чата
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: 'assistant', 
      content: 'Привет! 👋 Я онлайн-ассистент школы Baby Dance. Подскажу расписание, стоимость или помогу подобрать группу для вашего ребёнка!' 
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Состояния формы записи
  const [formData, setFormData] = useState({
    parent_name: '',
    child_name: '',
    phone: '',
    city: 'Серпухов'
  });
  const [formLoading, setFormLoading] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);

  // Флаг для пропуска первого рендера (чтобы страница не подпрыгивала при загрузке)
  const isInitialMount = useRef(true);

  // Автоскролл чата ТОЛЬКО при новых сообщениях
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, chatLoading]);

  // Отправка сообщения в чат
  const handleSendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage: Message = { role: 'user', content: chatInput };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      });
      const data = await res.json();
      if (data.reply) {
        setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: 'Ошибка соединения. Попробуйте еще раз!' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Отправка формы
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();

      if (data.status === 'success' && data.tg_url) {
        setTgUrl(data.tg_url);
      } else {
        alert('Ошибка при сохранении заявки. Попробуйте снова.');
      }
    } catch (e) {
      alert('Ошибка сети при отправке.');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 flex items-center justify-center p-4 sm:p-8 font-sans relative overflow-hidden">
      
      {/* Декоративные мягкие свечения на фоне (Liquid Glow Effects) */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-rose-300/40 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-300/40 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10 my-auto">
        
        {/* ЛЕВАЯ КОЛОНКА: Форма записи (7 колонок из 12) */}
        <div className="lg:col-span-7 bg-white/80 backdrop-blur-xl border border-slate-200/80 rounded-3xl p-6 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.06)] flex flex-col justify-between">
          <div>
            {/* Бэдж бренда */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-rose-50 border border-rose-100 rounded-full mb-6">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-xs font-bold text-rose-600 tracking-wide uppercase">
                Baby Dance • Серпухов
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-[1.15]">
              Где малыши становятся <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-indigo-600">чемпионами</span>
            </h1>
            
            <p className="text-sm text-slate-500 mt-3 leading-relaxed">
              Запишите ребенка на первое пробное занятие. Группы до 9 детей, индивидуальный подход и заботливая атмосфера.
            </p>
          </div>

          <div className="mt-8">
            {tgUrl ? (
              <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto text-xl font-bold shadow-lg shadow-emerald-200">
                  ✓
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">Заявка успешно принята!</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    Перейдите в наш Telegram-бот для подтверждения времени и выбора группы:
                  </p>
                </div>
                <a
                  href={tgUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full bg-[#24A1DE] hover:bg-[#1d8ec5] text-white font-bold py-3.5 px-6 rounded-xl shadow-md hover:shadow-lg transition-all text-sm"
                >
                  <span>Завершить запись в Telegram</span>
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.56 8.16l-1.97 9.28c-.15.68-.55.84-1.12.52l-3.05-2.25-1.47 1.42c-.16.16-.3.3-.62.3l.22-3.09 5.63-5.08c.24-.22-.05-.34-.37-.13l-6.96 4.38-2.99-.94c-.65-.2-.66-.65.14-.96l11.7-4.51c.54-.2 1.02.13.86.96z"/>
                  </svg>
                </a>
              </div>
            ) : (
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Имя родителя</label>
                    <input
                      type="text"
                      required
                      placeholder="Екатерина"
                      value={formData.parent_name}
                      onChange={e => setFormData({ ...formData, parent_name: e.target.value })}
                      className="w-full bg-slate-50/80 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Имя и возраст ребенка</label>
                    <input
                      type="text"
                      required
                      placeholder="Алиса, 4 года"
                      value={formData.child_name}
                      onChange={e => setFormData({ ...formData, child_name: e.target.value })}
                      className="w-full bg-slate-50/80 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Телефон</label>
                    <input
                      type="tel"
                      required
                      placeholder="+7 (900) 000-00-00"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full bg-slate-50/80 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Город</label>
                    <select
                      value={formData.city}
                      onChange={e => setFormData({ ...formData, city: e.target.value })}
                      className="w-full bg-slate-50/80 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    >
                      <option value="Серпухов">Серпухов</option>
                      <option value="Новокузнецк">Новокузнецк</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 px-6 rounded-xl shadow-lg shadow-slate-900/10 hover:shadow-xl transition-all text-sm mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? 'Сохранение...' : 'Записаться на урок →'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА: Виджет ИИ-Консультанта (5 колонок из 12) */}
        <div className="lg:col-span-5 bg-white border border-slate-200/80 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.06)] flex flex-col h-[520px] overflow-hidden">
          
          {/* Шапка чата */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-500 to-indigo-500 flex items-center justify-center text-white font-black text-xs shadow-md">
                  BD
                </div>
                <span className="w-3 h-3 bg-emerald-500 border-2 border-white rounded-full absolute bottom-0 right-0" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">ИИ-Консультант</h2>
                <p className="text-[11px] text-slate-400">Школа Baby Dance</p>
              </div>
            </div>
            <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full border border-emerald-100">
              Online
            </span>
          </div>

          {/* Лента сообщений */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#FAFBFD]">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-rose-500 text-white rounded-br-none shadow-sm font-medium'
                    : 'bg-white border border-slate-200/60 text-slate-700 rounded-bl-none shadow-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex items-center gap-1.5 text-slate-400 text-xs pl-2 py-1">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Поле ввода */}
          <div className="p-3 border-t border-slate-100 bg-white">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-rose-500/20 focus-within:border-rose-500 transition-all">
              <input
                type="text"
                placeholder="Напишите вопрос..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 bg-transparent px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
              />
              <button
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || chatLoading}
                className="w-8 h-8 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-all shadow-sm cursor-pointer"
              >
                ➔
              </button>
            </div>
          </div>

        </div>

      </div>
    </main>
  );
}