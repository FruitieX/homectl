import { useEffect, useState, type ReactNode } from 'react';
import { useInterval, useTimeout, useToggle } from 'usehooks-ts';
import { Calendar, Clock } from 'lucide-react';
import clsx from 'clsx';
import useIdle from '@/hooks/useIdle';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DashboardWidget,
  buildDashboardWidgetProxyPath,
  getDashboardWidgetOptionBoolean,
  getDashboardWidgetOptionString,
  resolveDashboardWidgetUrl,
} from '@/hooks/useDashboard';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  isAllDay: boolean;
};

type CalendarResponse = {
  events: CalendarEvent[];
};

type CalendarEventStatus = 'current' | 'upcoming' | 'past';

type CalendarEventView = {
  event: CalendarEvent;
  status: CalendarEventStatus;
  timeDisplay: ReactNode;
};

const fetchCalendar = async (
  calendarUrl: string,
): Promise<CalendarResponse> => {
  const res = await fetch(calendarUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch calendar: ${res.status}`);
  }
  const json: CalendarResponse = await res.json();
  return json;
};

const getNextMinuteDelay = (date: Date) => {
  return Math.max(
    1000,
    60 * 1000 - date.getSeconds() * 1000 - date.getMilliseconds(),
  );
};

const getNextClockDelay = (date: Date, showSeconds: boolean) => {
  if (!showSeconds) {
    return getNextMinuteDelay(date);
  }

  return Math.max(250, 1000 - date.getMilliseconds());
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const formatDateTime = (dateString: string, showDate: boolean = false) => {
  const date = new Date(dateString);

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (showDate) {
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return (
      <>
        <span className="font-bold">{dateStr}</span> {timeStr}
      </>
    );
  }

  return timeStr;
};

const formatDateOnly = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

const isMultiDayEvent = (event: CalendarEvent) => {
  const start = new Date(event.start);
  const end = new Date(event.end);

  if (event.isAllDay) {
    const startDate = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    );
    const endDate = new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
    );
    const diffInDays =
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffInDays > 1;
  }

  return start.toDateString() !== end.toDateString();
};

const formatEventTimeDisplay = (event: CalendarEvent) => {
  const isMultiDay = isMultiDayEvent(event);

  if (event.isAllDay) {
    if (isMultiDay) {
      const startDate = formatDateOnly(event.start);
      const endDate = formatDateOnly(event.end);
      return (
        <>
          <span className="font-bold">{startDate}</span> -{' '}
          <span className="font-bold">{endDate}</span>
        </>
      );
    }
    return 'All day';
  }

  if (isMultiDay) {
    const startDateTime = formatDateTime(event.start, true);
    const endDateTime = formatDateTime(event.end, true);
    return (
      <>
        {startDateTime} - {endDateTime}
      </>
    );
  }

  return `${formatTime(event.start)} - ${formatTime(event.end)}`;
};

const getNextEvent = (events: CalendarEvent[], now: Date) => {
  return events.find((event) => {
    const eventStart = new Date(event.start);
    return eventStart > now;
  });
};

const getCurrentEvent = (events: CalendarEvent[], now: Date) => {
  return events
    .filter((event) => !event.isAllDay)
    .find((event) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventStart <= now && eventEnd > now;
    });
};

const getCurrentAllDayEvent = (events: CalendarEvent[], now: Date) => {
  return events
    .filter((event) => event.isAllDay)
    .find((event) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventStart <= now && eventEnd > now;
    });
};

const getEventStatus = (
  event: CalendarEvent,
  now: Date,
): CalendarEventStatus => {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  if (eventStart <= now && eventEnd > now) {
    return 'current';
  }

  if (eventEnd < now) {
    return 'past';
  }

  return 'upcoming';
};

const buildEventViews = (events: CalendarEvent[], now: Date) => {
  return events.map((event) => ({
    event,
    status: getEventStatus(event, now),
    timeDisplay: formatEventTimeDisplay(event),
  }));
};

function useMinuteNow(enabled: boolean) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNextTick = () => {
      const nextNow = new Date();
      setNow(nextNow);
      timeoutId = setTimeout(scheduleNextTick, getNextMinuteDelay(nextNow));
    };

    scheduleNextTick();
    return () => clearTimeout(timeoutId);
  }, [enabled]);

  return now;
}

function LiveClockDisplay({
  showSeconds,
  showDate,
}: {
  showSeconds: boolean;
  showDate: boolean;
}) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNextTick = () => {
      const nextTime = new Date();
      setTime(nextTime);
      timeoutId = setTimeout(
        scheduleNextTick,
        getNextClockDelay(nextTime, showSeconds),
      );
    };

    scheduleNextTick();
    return () => clearTimeout(timeoutId);
  }, [showSeconds]);

  return (
    <>
      <span className="font-sans text-[clamp(1.75rem,8vw,3.5rem)] font-semibold leading-none tracking-[-0.06em] tabular-nums">
        {time.getHours().toString().padStart(2, '0')}:
        {time.getMinutes().toString().padStart(2, '0')}
        {showSeconds
          ? `:${time.getSeconds().toString().padStart(2, '0')}`
          : ''}
      </span>
      {showDate ? (
        <span className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {time.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ) : null}
    </>
  );
}

function CalendarSummary({
  showCalendar,
  error,
  calendar,
  now,
}: {
  showCalendar: boolean;
  error: string | null;
  calendar: CalendarResponse | null;
  now: Date;
}) {
  if (!showCalendar || error || !calendar) return null;

  const events = calendar.events;
  const currentEvent = getCurrentEvent(events, now);
  const currentAllDayEvent = getCurrentAllDayEvent(events, now);
  const nextEvent = getNextEvent(events, now);

  if (events.length === 0) return null;

  const displayEvent = currentEvent || nextEvent || currentAllDayEvent;
  if (!displayEvent) return null;

  return (
    <div className="mt-3 w-full border-t border-border/60 pt-3 text-center">
      <div className="mb-1 flex items-center justify-center gap-1">
        <Calendar className="size-3" />
        {currentEvent && <Badge>Now</Badge>}
        {!currentEvent && nextEvent && (
          <Badge variant="secondary">Upcoming</Badge>
        )}
        {!currentEvent && !nextEvent && currentAllDayEvent && (
          <Badge>All day</Badge>
        )}
      </div>
      <div className="max-w-full truncate text-xs font-medium">
        {displayEvent.summary}
      </div>
      <div className="flex min-w-0 items-center justify-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3 shrink-0" />
        <div className="max-w-full truncate">
          {formatEventTimeDisplay(displayEvent)}
        </div>
      </div>
    </div>
  );
}

function CalendarEventCard({ view }: { view: CalendarEventView }) {
  const { event, status, timeDisplay } = view;
  const isCurrentEvent = status === 'current';
  const isPastEvent = status === 'past';
  const isUpcomingEvent = status === 'upcoming';

  return (
    <Card
      className={clsx(
        'content-visibility-card',
        isCurrentEvent && 'ring-2 ring-primary',
        isPastEvent && 'opacity-60',
      )}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div className="shrink-0">
          {isCurrentEvent && <Badge>Now</Badge>}
          {isUpcomingEvent && <Badge variant="secondary">Upcoming</Badge>}
          {isPastEvent && <Badge variant="outline">Past</Badge>}
        </div>
        <div className="flex-1">
          <h3 className="mb-1 text-lg font-semibold">{event.summary}</h3>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-4" />
            <span>{timeDisplay}</span>
          </div>
          {event.location && (
            <div className="mb-2 text-sm text-muted-foreground">
              📍 {event.location}
            </div>
          )}
          {event.description && (
            <div className="mt-2 text-sm text-muted-foreground">
              {event.description}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export const ClockCard = ({ widget }: { widget?: DashboardWidget }) => {
  const { apiEndpoint } = useAppConfig();
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showSeconds = getDashboardWidgetOptionBoolean(
    widget,
    'showSeconds',
    false,
  );
  const showDate = getDashboardWidgetOptionBoolean(widget, 'showDate', true);
  const showCalendar = getDashboardWidgetOptionBoolean(
    widget,
    'showCalendar',
    true,
  );
  const calendarUrlOverride = getDashboardWidgetOptionString(
    widget,
    'calendarUrl',
    '',
  );
  const calendarPath = calendarUrlOverride
    ? buildDashboardWidgetProxyPath('/api/calendar', {
        url: calendarUrlOverride,
      })
    : getDashboardWidgetOptionString(widget, 'calendarPath', '/api/calendar');
  const calendarUrl = resolveDashboardWidgetUrl(apiEndpoint, calendarPath);

  const isIdle = useIdle();
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);
  const calendarNow = useMinuteNow(showCalendar || detailsModalOpen);
  const eventViews = detailsModalOpen && calendar
    ? buildEventViews(calendar.events, calendarNow)
    : [];

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      try {
        const calendar = await fetchCalendar(calendarUrl);
        if (isSubscribed === true) {
          setCalendar(calendar);
          setError(null);
        }
      } catch (err) {
        if (isSubscribed === true) {
          setError(
            err instanceof Error ? err.message : 'Failed to fetch calendar',
          );
        }
      }
    };
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [calendarUrl]);

  useInterval(
    async () => {
      try {
        const calendar = await fetchCalendar(calendarUrl);
        setCalendar(calendar);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to fetch calendar',
        );
      }
    },
    60 * 60 * 1000,
  ); // Refresh every hour

  useTimeout(
    () => {
      setDetailsModalOpen(false);
    },
    detailsModalOpen && isIdle ? 10 * 1000 : null,
  );

  return (
    <>
      <Card className="col-span-2 overflow-hidden">
        <Button
          variant="ghost"
          className="h-full w-full"
          onClick={toggleDetailsModal}
        >
          <CardContent className="flex w-full flex-col items-center justify-center px-4 py-5">
            <LiveClockDisplay showSeconds={showSeconds} showDate={showDate} />
            <CalendarSummary
              showCalendar={showCalendar}
              error={error}
              calendar={calendar}
              now={calendarNow}
            />
          </CardContent>
        </Button>
      </Card>
      <ResponsiveOverlay
        open={detailsModalOpen}
        onOpenChange={setDetailsModalOpen}
        title="Today's agenda"
        description="Upcoming and in-progress calendar events."
        className="max-w-3xl"
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          <div className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {calendar && calendar.events.length === 0 && (
              <EmptyState
                icon={<Calendar className="size-12" />}
                title="No events scheduled for today"
              />
            )}
            {eventViews.map((view) => (
              <CalendarEventCard key={view.event.id} view={view} />
            ))}
          </div>
        </div>
      </ResponsiveOverlay>
    </>
  );
};
