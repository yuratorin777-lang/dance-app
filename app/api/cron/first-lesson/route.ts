import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Проверяем, что запрос действительно пришел от встроенного планировщика Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_WEBHOOK_URL!;
  const CRON_SECRET = process.env.CRON_SECRET!;

  // Vercel дергает наш Apps Script (ветку action=cron в doGet)
  const response = await fetch(`${APPS_SCRIPT_URL}?action=cron&secret=${CRON_SECRET}`, {
    method: 'GET',
    cache: 'no-store'
  });

  const data = await response.json();
  return NextResponse.json(data);
}