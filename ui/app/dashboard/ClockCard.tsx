import { useEffect, useState } from 'react';
import { useInterval, useTimeout, useToggle } from 'usehooks-ts';
import { X, Calendar, Clock } from 'lucide-react';
import clsx from 'clsx';
import useIdle from '@/hooks/useIdle';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DashboardWidget,
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

export const ClockCard = ({ widget }: { widget?: DashboardWidget }) => {
  const { apiEndpoint } = useAppConfig();
  const [time, setTime] = useState<Date | null>(null);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const calendarUrl = resolveDashboardWidgetUrl(
    apiEndpoint,
    getDashboardWidgetOptionString(widget, 'calendarPath', '/api/calendar'),
  );

  const isIdle = useIdle();
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);

  useEffect(() => {
    setTime(new Date());
  }, []);

  useInterval(async () => {
    setTime(new Date());
  }, 1000);

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
    } else {
      return timeStr;
    }
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

    // For all-day events, check if it's more than one day
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

  const getEventDuration = (event: CalendarEvent) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    return end.getTime() - start.getTime();
  };

  const getNextEvent = (events: CalendarEvent[]) => {
    const now = new Date();
    return events.find((event) => {
      const eventStart = new Date(event.start);
      return eventStart > now;
    });
  };

  const getCurrentEvent = (events: CalendarEvent[]) => {
    const now = new Date();
    return events
      .filter((event) => !event.isAllDay)
      .find((event) => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        return eventStart <= now && eventEnd > now;
      });
  };

  const getCurrentAllDayEvent = (events: CalendarEvent[]) => {
    const now = new Date();
    return events
      .filter((event) => event.isAllDay)
      .find((event) => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        return eventStart <= now && eventEnd > now;
      });
  };

  const renderCalendarInfo = () => {
    if (error || !calendar) return null;

    const events = calendar.events;
    const currentEvent = getCurrentEvent(events);
    const currentAllDayEvent = getCurrentAllDayEvent(events);
    const nextEvent = getNextEvent(events);

    if (events.length === 0) return null;

    const displayEvent = currentEvent || nextEvent || currentAllDayEvent;
    if (!displayEvent) return null;

    return (
      <div className="text-center mt-1 w-full">
        <div className="flex items-center justify-center gap-1 mb-1">
          <Calendar className="size-3" />
          {currentEvent && <Badge>Now</Badge>}
          {!currentEvent && nextEvent && (
            <Badge variant="secondary">Upcoming</Badge>
          )}
          {!currentEvent && !nextEvent && currentAllDayEvent && (
            <Badge>All day</Badge>
          )}
        </div>
        <div className="text-xs font-medium truncate max-w-full">
          {displayEvent.summary}
        </div>
        <div className="flex min-w-0 items-center justify-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3 shrink-0" />
          <div className="truncate max-w-full">
            {formatEventTimeDisplay(displayEvent)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Card className="col-span-2 overflow-hidden">
        <Button
          variant="ghost"
          className="h-full w-full"
          onClick={toggleDetailsModal}
        >
          <CardContent className="flex w-full items-center justify-center px-0 py-5">
            <span className="text-[clamp(1.5rem,8vw,3rem)] leading-none">
              {time !== null && (
                <>
                  {time.getHours().toString().padStart(2, '0')}:
                  {time.getMinutes().toString().padStart(2, '0')}
                </>
              )}
            </span>
            {renderCalendarInfo()}
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
          <div className="flex justify-end">
            <Button onClick={toggleDetailsModal} variant="outline" size="icon">
              <X />
            </Button>
          </div>

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
            {calendar &&
              calendar.events.map((event, index) => {
                const now = new Date();
                const eventStart = new Date(event.start);
                const eventEnd = new Date(event.end);
                const isCurrentEvent = eventStart <= now && eventEnd > now;
                const isPastEvent = eventEnd < now;
                const isUpcomingEvent = eventStart > now;

                return (
                  <Card
                    key={event.id}
                    className={clsx(
                      isCurrentEvent && 'ring-2 ring-primary',
                      isPastEvent && 'opacity-60',
                    )}
                  >
                    <CardContent className="flex items-start gap-3 p-4">
                      <div className="shrink-0">
                        {isCurrentEvent && <Badge>Now</Badge>}
                        {isUpcomingEvent && (
                          <Badge variant="secondary">Upcoming</Badge>
                        )}
                        {isPastEvent && <Badge variant="outline">Past</Badge>}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">
                          {event.summary}
                        </h3>
                        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span>{formatEventTimeDisplay(event)}</span>
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
              })}
          </div>
        </div>
      </ResponsiveOverlay>
    </>
  );
};
