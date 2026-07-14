import cron from 'node-cron';
import { sendApproachingDeadlineReminders, expireOverdueQuotes } from '../services/reminderService';

const SCHEDULE = process.env.REMINDER_CRON_SCHEDULE || '*/5 * * * *'; // every 5 minutes

export function startDeadlineReminderJob(): void {
  cron.schedule(SCHEDULE, async () => {
    try {
      const reminded = await sendApproachingDeadlineReminders();
      const expired = await expireOverdueQuotes();
      if (reminded > 0 || expired > 0) {
        console.log(`[deadlineReminderJob] reminders sent: ${reminded}, quotes expired: ${expired}`);
      }
    } catch (err) {
      console.error('[deadlineReminderJob] run failed:', err);
    }
  });

  console.log(`[deadlineReminderJob] scheduled with cron "${SCHEDULE}"`);
}
