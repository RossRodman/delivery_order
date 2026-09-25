-- Review hardening (specs/001-order-screen/review.md m-2, m-3). Applied migrations are never edited.

-- m-2: lock the parent order row FOR SHARE while checking its status. A concurrent transaction that
-- is flipping the order to `saved` holds a conflicting row lock, so a line insert/update/delete waits
-- for it and then sees `saved` (→ OS409) instead of slipping in beside the save. Conversely, a save
-- that starts after a line change waits for that transaction and its validation sees the committed
-- line. App transactions already hold the order FOR UPDATE, which is compatible with their own
-- FOR SHARE.
CREATE OR REPLACE FUNCTION order_lines_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status order_status;
  parent_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD.order_id;
  ELSE
    parent_id := NEW.order_id;
  END IF;
  SELECT status INTO parent_status FROM orders WHERE id = parent_id FOR SHARE;
  IF parent_status = 'saved' THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = 'OS409',
      DETAIL = format('order %s is saved', parent_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    SELECT status INTO parent_status FROM orders WHERE id = OLD.order_id FOR SHARE;
    IF parent_status = 'saved' THEN
      RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = 'OS409',
        DETAIL = format('order %s is saved', OLD.order_id);
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- m-3: an approval must come from an owner and go through `pending`.
--   * a line can never be inserted as approved;
--   * a line can become approved only from `pending`, with decided_by = a user whose role is owner
--     and decided_at set;
--   * an existing approval may be kept unchanged (e.g. position-only updates) but not rewritten.
-- Named order_lines_approval_guard so it fires before order_lines_void_approval (alphabetical).
CREATE FUNCTION order_lines_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  decider_role user_role;
BEGIN
  IF NEW.approval_status <> 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRES_OWNER' USING ERRCODE = 'OS422',
      DETAIL = format('line %s cannot be inserted as approved', NEW.id);
  END IF;
  IF OLD.approval_status = 'approved'
     AND (NEW.approved_product_id, NEW.approved_qty, NEW.approved_unit_price_cents,
          NEW.approved_discount_cents, NEW.decided_by, NEW.decided_at)
         IS NOT DISTINCT FROM
         (OLD.approved_product_id, OLD.approved_qty, OLD.approved_unit_price_cents,
          OLD.approved_discount_cents, OLD.decided_by, OLD.decided_at) THEN
    RETURN NEW; -- unchanged approval
  END IF;
  IF OLD.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRES_OWNER' USING ERRCODE = 'OS422',
      DETAIL = format('line %s: approval must follow a pending request (was %s)', NEW.id, OLD.approval_status);
  END IF;
  SELECT role INTO decider_role FROM users WHERE id = NEW.decided_by;
  IF decider_role IS DISTINCT FROM 'owner' OR NEW.decided_at IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRES_OWNER' USING ERRCODE = 'OS422',
      DETAIL = format('line %s: decided_by must be an owner and decided_at set', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_approval_guard BEFORE INSERT OR UPDATE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION order_lines_approval_guard();
