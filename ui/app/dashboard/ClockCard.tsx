import { useEffect, useState } from 'react';
import { Button, Card, Modal } from 'react-daisyui';
import { useInterval, useTimeout, useToggle } from 'usehooks-ts';
import { cachedPromise } from './cachedPromise';
import { useAppConfig } from '@/hooks/appConfig';
import { X, Calendar, Clock } from 'lucide-react';
import clsx from 'clsx';
import useIdle from '@/hooks/useIdle';

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

const fetchCachedCalendar = async (url: string): Promise<CalendarResponse> => {
  const json = await cachedPromise('calendarResponseCache', 30, async () => {
    if (url === undefined) {
      throw new Error('CALENDAR_API_URL is undefined');
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch calendar: ${res.status}`);
    }
    const json: CalendarResponse = await res.json();
    return json;
  });

  return json;
};

export const ClockCard = () => {
  const [time, setTime] = useState<Date | null>(null);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const calendarApiUrl = useAppConfig().calendarApiUrl;
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

    const fetch = async () => {
      try {
        const calendar = await fetchCachedCalendar(calendarApiUrl);
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
    fetch();

    return () => {
      isSubscribed = false;
    };
  }, [calendarApiUrl]);

  useInterval(
    async () => {
      try {
        const calendar = await fetchCachedCalendar(calendarApiUrl);
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
      <div className="text-center mt-1">
        <div className="flex items-center justify-center gap-1 mb-1">
          <Calendar className="w-3 h-3" />
          {currentEvent && (
            <div className="badge badge-success badge-xs">Now</div>
          )}
          {!currentEvent && nextEvent && (
            <div className="badge badge-info badge-xs">Upcoming</div>
          )}
          {!currentEvent && !nextEvent && currentAllDayEvent && (
            <div className="badge badge-success badge-xs">All day</div>
          )}
        </div>
        <div className="text-xs font-medium line-clamp-1">
          {displayEvent.summary}
        </div>
        {!displayEvent.isAllDay && (
          <div className="text-xs text-base-content/70 flex items-center justify-center gap-1">
            <Clock className="w-2 h-2" />
            {formatTime(displayEvent.start)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Card compact className="col-span-1 bg-base-300">
        <Button color="ghost" className="h-full" onClick={toggleDetailsModal}>
          <Card.Body className="flex items-center justify-center">
            <span className="text-6xl">
              {time !== null && (
                <>
                  {time.getHours().toString().padStart(2, '0')}:
                  {time.getMinutes().toString().padStart(2, '0')}
                </>
              )}
            </span>
            {renderCalendarInfo()}
          </Card.Body>
        </Button>
      </Card>
      <Modal.Legacy
        open={detailsModalOpen}
        onClickBackdrop={toggleDetailsModal}
        responsive
        className="pt-0"
      >
        <Modal.Header className="sticky w-auto top-0 p-6 m-0 -mx-6 z-10 bg-base-100 bg-opacity-75 backdrop-blur-sm">
          <div className="flex items-center justify-between font-bold">
            <div className="mx-4 text-center">{"Today's agenda"}</div>
            <Button onClick={toggleDetailsModal} variant="outline">
              <X />
            </Button>
          </div>
        </Modal.Header>
        <Modal.Body className="flex flex-col gap-4 pt-1">
          {error && (
            <div className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
          {calendar && calendar.events.length === 0 && (
            <div className="text-center py-8">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-base-content/50" />
              <p className="text-lg">No events scheduled for today</p>
            </div>
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
                <div
                  key={event.id}
                  className={clsx(
                    'card bg-base-200 p-4',
                    isCurrentEvent && 'ring-2 ring-success',
                    isPastEvent && 'opacity-60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {isCurrentEvent && (
                        <div className="badge badge-success badge-sm">Now</div>
                      )}
                      {isUpcomingEvent && (
                        <div className="badge badge-info badge-sm">
                          Upcoming
                        </div>
                      )}
                      {isPastEvent && (
                        <div className="badge badge-ghost badge-sm">Past</div>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1">
                        {event.summary}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-base-content/70 mb-2">
                        <Clock className="w-4 h-4" />
                        {event.isAllDay ? (
                          <span>All day</span>
                        ) : (
                          <span>
                            {formatTime(event.start)} - {formatTime(event.end)}
                          </span>
                        )}
                      </div>
                      {event.location && (
                        <div className="text-sm text-base-content/70 mb-2">
                          📍 {event.location}
                        </div>
                      )}
                      {event.description && (
                        <div className="text-sm text-base-content/80 mt-2">
                          {event.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </Modal.Body>
      </Modal.Legacy>
    </>
  );
};
