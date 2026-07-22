-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InterventionType" ADD VALUE 'HIGHLIGHT';
ALTER TYPE "InterventionType" ADD VALUE 'TOOLTIP';
ALTER TYPE "InterventionType" ADD VALUE 'MODAL';
ALTER TYPE "InterventionType" ADD VALUE 'BANNER';
ALTER TYPE "InterventionType" ADD VALUE 'INLINE_HINT';
ALTER TYPE "InterventionType" ADD VALUE 'SPOTLIGHT';
ALTER TYPE "InterventionType" ADD VALUE 'TOUR';
ALTER TYPE "InterventionType" ADD VALUE 'ICON_FLASH';
ALTER TYPE "InterventionType" ADD VALUE 'ARROW';
ALTER TYPE "InterventionType" ADD VALUE 'AUTO_FIX';
ALTER TYPE "InterventionType" ADD VALUE 'CONFIRM';
ALTER TYPE "InterventionType" ADD VALUE 'ANNOUNCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StruggleType" ADD VALUE 'DEAD_CLICK';
ALTER TYPE "StruggleType" ADD VALUE 'INVALID_CLICK';
ALTER TYPE "StruggleType" ADD VALUE 'MIS_CLICK';
ALTER TYPE "StruggleType" ADD VALUE 'BACKTRACK';
ALTER TYPE "StruggleType" ADD VALUE 'VALIDATION_LOOP';
ALTER TYPE "StruggleType" ADD VALUE 'ABANDONED_FIELD';
ALTER TYPE "StruggleType" ADD VALUE 'PASTE_REPEAT';
ALTER TYPE "StruggleType" ADD VALUE 'REQUIRED_MISSED';
ALTER TYPE "StruggleType" ADD VALUE 'FORMAT_ERROR';
ALTER TYPE "StruggleType" ADD VALUE 'PASSWORD_RETRY';
ALTER TYPE "StruggleType" ADD VALUE 'SLOW_FILL';
ALTER TYPE "StruggleType" ADD VALUE 'BACK_THRASH';
ALTER TYPE "StruggleType" ADD VALUE 'DEAD_END';
ALTER TYPE "StruggleType" ADD VALUE 'QUICK_BOUNCE';
ALTER TYPE "StruggleType" ADD VALUE 'CIRCULAR_NAV';
ALTER TYPE "StruggleType" ADD VALUE 'HOVER_HUNT';
ALTER TYPE "StruggleType" ADD VALUE 'LONG_DWELL';
ALTER TYPE "StruggleType" ADD VALUE 'RAPID_SCROLL';
ALTER TYPE "StruggleType" ADD VALUE 'SCROLL_OVERSHOOT';
ALTER TYPE "StruggleType" ADD VALUE 'IDLE_AFTER_LOAD';
ALTER TYPE "StruggleType" ADD VALUE 'EMPTY_SEARCH';
ALTER TYPE "StruggleType" ADD VALUE 'REPEAT_SEARCH';
ALTER TYPE "StruggleType" ADD VALUE 'ZERO_RESULTS';
ALTER TYPE "StruggleType" ADD VALUE 'FAILED_FILTER';
ALTER TYPE "StruggleType" ADD VALUE 'MENU_THRASH';
ALTER TYPE "StruggleType" ADD VALUE 'TOOLTIP_HOVER_REPEAT';
ALTER TYPE "StruggleType" ADD VALUE 'TAB_HOPPING';
ALTER TYPE "StruggleType" ADD VALUE 'ERROR_DISMISS';
ALTER TYPE "StruggleType" ADD VALUE 'RETRY_LOOP';
ALTER TYPE "StruggleType" ADD VALUE 'NOT_FOUND_BOUNCE';
ALTER TYPE "StruggleType" ADD VALUE 'JS_ERROR';
ALTER TYPE "StruggleType" ADD VALUE 'LOGIN_FAILURE';
ALTER TYPE "StruggleType" ADD VALUE 'LOCKED_OUT';
ALTER TYPE "StruggleType" ADD VALUE 'KEYBOARD_LOST_FOCUS';
ALTER TYPE "StruggleType" ADD VALUE 'COPY_BOUNCE';
ALTER TYPE "StruggleType" ADD VALUE 'HELP_HUNT';
