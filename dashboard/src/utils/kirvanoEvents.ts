import { CheckCircle2, Clock, QrCode, ShoppingCart } from 'lucide-react';
import type { KirvanoEventType } from '../services/api';

export const KIRVANO_EVENT_TYPES: KirvanoEventType[] = [
  'ON_ABANDONED_CART',
  'ON_PIX_EXPIRED',
  'ON_PIX_GENERATED',
  'ON_SALE_APPROVED',
];

/** Shared icon per Kirvano event, used by both the config cards (Kirvano.tsx) and the stats/KPI
 *  section (KirvanoCharts.tsx) so the two stay visually consistent without duplicating the map. */
export const EVENT_ICONS: Record<KirvanoEventType, typeof ShoppingCart> = {
  ON_ABANDONED_CART: ShoppingCart,
  ON_PIX_EXPIRED: Clock,
  ON_PIX_GENERATED: QrCode,
  ON_SALE_APPROVED: CheckCircle2,
};

/** Stable, distinct color per event type for the line chart (recharts needs literal colors). */
export const EVENT_COLORS: Record<KirvanoEventType, string> = {
  ON_ABANDONED_CART: '#f59e0b',
  ON_PIX_EXPIRED: '#ef4444',
  ON_PIX_GENERATED: '#3b82f6',
  ON_SALE_APPROVED: '#25d366',
};
