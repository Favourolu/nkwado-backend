import cron from 'node-cron';
import prisma from '../utils/prisma';
import {
  sendApproachingDeadlineReminders,
  sendApproachingSubmittedExpiryReminders,
  expireOverdueQuotes,
  expireOverdueSubmittedQuotes,
} from '../services/reminderService';

const SCHEDULE = process.env.REMINDER_CRON_SCHEDULE || '*/5 * * * *'; // every 5 minutes
export const HEARTBEAT_NAME = 'deadlineReminderJob';

export function startDeadlineReminderJob(): void {
  cron.schedule(SCHEDULE, async () => {
    try {
      const reminded = await sendApproachingDeadlineReminders();
      const expired = await expireOverdueQuotes();
      const submittedReminded = await sendApproachingSubmittedExpiryReminders();
      const submittedExpired = await expireOverdueSubmittedQuotes();
      if (reminded > 0 || expired > 0 || submittedReminded > 0 || submittedExpired > 0) {
        console.log(
          `[deadlineReminderJob] reminders sent: ${reminded}, quotes expired: ${expired}, ` +
            `submitted-expiry reminders sent: ${submittedReminded}, submitted quotes expired: ${submittedExpired}`
        );
      }
      // Written on every tick regardless of activity — GET /admin/health/cron reads this to
      // detect a dead cron process from a stale timestamp instead of failures being silent
      // (see architecture audit, section 5).
      await prisma.cronHeartbeat.upsert({
        where: { name: HEARTBEAT_NAME },
        create: { name: HEARTBEAT_NAME, lastRunAt: new Date(), lastRunOk: true, lastError: null },
        update: { lastRunAt: new Date(), lastRunOk: true, lastError: null },
      });
    } catch (err) {
      console.error('[deadlineReminderJob] run failed:', err);
      await prisma.cronHeartbeat
        .upsert({
          where: { name: HEARTBEAT_NAME },
          create: { name: HEARTBEAT_NAME, lastRunAt: new Date(), lastRunOk: false, lastError: String(err) },
          update: { lastRunAt: new Date(), lastRunOk: false, lastError: String(err) },
        })
        .catch(() => undefined);
    }
  });

  console.log(`[deadlineReminderJob] scheduled with cron "${SCHEDULE}"`);
}
