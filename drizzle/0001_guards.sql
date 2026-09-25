-- Guards (plan.md §4.2). Custom SQLSTATEs are mapped to API errors in src/server/http/errors.ts:
--   OS409 → 409 ORDER_IMMUTABLE
--   OS422 → 422, error code in MESSAGE (UNAPPROVED_BLOCKED_LINES / EMPTY_ORDER / PRICE_MISMATCH / ...),
--           offending line ids (comma-separated) in DETAIL
--   OS500 → 500 TOTALS_MISMATCH
-- Same-event triggers fire alphabetically: *_immutable_guard runs before *_validate_save / *_void_approval.

-- 1. An order can only be created as a draft; `saved` is reachable only via the validated transition.
CREATE FUNCTION orders_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'ORDER_MUST_START_AS_DRAFT' USING ERRCODE = 'OS422',
      DETAIL = format('order %s inserted with status %s', NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_insert_guard BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_insert_guard();
--> statement-breakpoint

-- 2. Saved orders are immutable (R7).
CREATE FUNCTION orders_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'saved' THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = 'OS409',
      DETAIL = format('order %s is saved', OLD.id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_immutable_guard BEFORE UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_immutable_guard();
--> statement-breakpoint

-- 3. Lines of a saved order can never be inserted, changed or deleted (R7).
CREATE FUNCTION order_lines_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status order_status;
  parent_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD.order_id;
  ELSE
    parent_id := NEW.order_id;
  END IF;
  SELECT status INTO parent_status FROM orders WHERE id = parent_id;
  IF parent_status = 'saved' THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = 'OS409',
      DETAIL = format('order %s is saved', parent_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    SELECT status INTO parent_status FROM orders WHERE id = OLD.order_id;
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
CREATE TRIGGER order_lines_immutable_guard BEFORE INSERT OR UPDATE OR DELETE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION order_lines_immutable_guard();
--> statement-breakpoint

-- 4. Any change to the line terms voids an approval/decision (R4, AC6), even if the app forgets.
CREATE FUNCTION order_lines_void_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.product_id, NEW.qty, NEW.unit_price_cents, NEW.discount_cents)
       IS DISTINCT FROM (OLD.product_id, OLD.qty, OLD.unit_price_cents, OLD.discount_cents) THEN
    NEW.approval_status := 'none';
    NEW.approved_product_id := NULL;
    NEW.approved_qty := NULL;
    NEW.approved_unit_price_cents := NULL;
    NEW.approved_discount_cents := NULL;
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_void_approval BEFORE UPDATE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION order_lines_void_approval();
--> statement-breakpoint

-- 5. The save transition re-checks everything (AC2 DB-level guard, R1, R8).
CREATE FUNCTION orders_validate_save() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count integer;
  bad_ids text;
  expected_usd bigint;
  expected_sdg bigint;
BEGIN
  SELECT count(*) INTO line_count FROM order_lines WHERE order_id = NEW.id;
  IF line_count = 0 THEN
    RAISE EXCEPTION 'EMPTY_ORDER' USING ERRCODE = 'OS422', DETAIL = '';
  END IF;

  -- R3 blocked (d*100 > 5*v, exact integers) without an approval bound to the current terms (R4).
  SELECT string_agg(l.id::text, ',' ORDER BY l.position) INTO bad_ids
  FROM order_lines l
  WHERE l.order_id = NEW.id
    AND l.discount_cents * 100 > 5 * l.qty::bigint * l.unit_price_cents
    AND NOT (
      l.approval_status = 'approved'
      AND l.approved_product_id = l.product_id
      AND l.approved_qty = l.qty
      AND l.approved_unit_price_cents = l.unit_price_cents
      AND l.approved_discount_cents = l.discount_cents
    );
  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION 'UNAPPROVED_BLOCKED_LINES' USING ERRCODE = 'OS422', DETAIL = bad_ids;
  END IF;

  -- R1: a saved order's unit prices are the DB prices at save time.
  SELECT string_agg(l.id::text, ',' ORDER BY l.position) INTO bad_ids
  FROM order_lines l
  JOIN products p ON p.id = l.product_id
  WHERE l.order_id = NEW.id AND l.unit_price_cents <> p.unit_price_cents;
  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION 'PRICE_MISMATCH' USING ERRCODE = 'OS422', DETAIL = bad_ids;
  END IF;

  -- R8 cross-check of the domain module (same formula: half-up on non-negative integers).
  SELECT sum(l.qty::bigint * l.unit_price_cents - l.discount_cents) INTO expected_usd
  FROM order_lines l WHERE l.order_id = NEW.id;
  expected_sdg := (expected_usd * NEW.rate + 50) / 100;
  IF NEW.total_usd_cents IS DISTINCT FROM expected_usd OR NEW.total_sdg IS DISTINCT FROM expected_sdg THEN
    RAISE EXCEPTION 'TOTALS_MISMATCH' USING ERRCODE = 'OS500',
      DETAIL = format('expected usd=%s sdg=%s, got usd=%s sdg=%s',
                      expected_usd, expected_sdg, NEW.total_usd_cents, NEW.total_sdg);
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_validate_save BEFORE UPDATE OF status ON orders
  FOR EACH ROW WHEN (NEW.status = 'saved' AND OLD.status <> 'saved')
  EXECUTE FUNCTION orders_validate_save();
