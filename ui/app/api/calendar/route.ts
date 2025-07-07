import { NextResponse } from 'next/server';
import ICAL from 'ical.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get ICS URL from environment variable
    const icsUrl = process.env.GOOGLE_CALENDAR_ICS_URL;

    if (!icsUrl) {
      return NextResponse.json(
        { error: 'Missing Google Calendar ICS URL' },
        { status: 500 },
      );
    }

    // Fetch the ICS data
    const response = await fetch(icsUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ICS: ${response.status}`);
    }

    const icsData = await response.text();

    // Parse the ICS data
    const jcalData = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );
    
    // Process events
    const events = vevents
      .map((vevent) => {
        const event = new ICAL.Event(vevent);

        // Get event dates
        const startDate = event.startDate ? event.startDate.toJSDate() : null;
        const endDate = event.endDate ? event.endDate.toJSDate() : null;

        if (!startDate) return null;

        // Check if event is happening today (includes multi-day events)
        const isHappeningToday =
          startDate < endOfDay && (!endDate || endDate > startOfDay);
        if (!isHappeningToday) return null;

        // Check if it's an all-day event (no time component)
        const isAllDay = !event.startDate?.isDate
          ? false
          : event.startDate.isDate;

        return {
          id: event.uid || Math.random().toString(36),
          summary: event.summary || 'No Title',
          start: startDate.toISOString(),
          end: endDate ? endDate.toISOString() : startDate.toISOString(),
          description: event.description || undefined,
          location: event.location || undefined,
          isAllDay: isAllDay,
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 10); // Limit to 10 events

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar events' },
      { status: 500 },
    );
  }
}
