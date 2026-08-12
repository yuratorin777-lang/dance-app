import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const APPS_SCRIPT_URL = process.env.GOOGLE_SCRIPT_WEB_APP_URL || process.env.APPS_SCRIPT_WEBHOOK_URL || '';
  const CRON_SECRET = process.env.CRON_SECRET || '';

  if (!APPS_SCRIPT_URL) {
    return NextResponse.json({ error: 'Missing Apps Script URL' }, { status: 500 });
  }

  try {
    const response = await fetch(`${APPS_SCRIPT_URL}?action=cron&secret=${CRON_SECRET}`, {
      method: 'GET',
      cache: 'no-store'
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}