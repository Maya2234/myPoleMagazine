-- Dragging the cards in Current goals into your own order.
--
-- The home screen lists the moves in your Current goals collection. Until this file is run that list
-- is newest-edited-first, which is a sensible default and not an order anybody chose - so a card can
-- be dragged, but there is nowhere to remember where it was put.
--
-- The place lives on `move_categories`, the row that already links a move to a collection, rather than
-- on the move itself: the same move can sit in Current goals and in a collection called "Inverts", and
-- it can be first in one of them and last in the other. One column on the move could not say that.
--
-- Run this once in the Supabase SQL editor. It is safe to run again: the column is added only if it is
-- missing, the policy is dropped and recreated, and nothing is deleted. Until it has been run the app
-- carries on exactly as it did before - the list keeps its newest-first order, and trying to drag a
-- card says what to run rather than quietly forgetting.


-- 1. The place, 0 at the top of a collection.
alter table public.move_categories
  add column if not exists position int not null default 0;


-- 2. Changing the place of a link you own. Insert and delete were already allowed - adding a move to
--    a collection and taking it out - and this is the third thing a drag does. The check is the same
--    one those use: the move has to be yours, so nobody can rearrange someone else's collection.
grant update on public.move_categories to authenticated;

drop policy if exists move_categories_update_own on public.move_categories;
create policy move_categories_update_own on public.move_categories for update to authenticated
  using (
    exists (select 1 from public.moves m where m.id = move_categories.move_id and m.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.moves m where m.id = move_categories.move_id and m.user_id = auth.uid())
  );


-- 3. Backfill: every link that has never been given a place gets one, numbered in the order the list
--    reads in today (newest edit first). That way the first visit after running this shows the same
--    order as the visit before it, and only the cards a dancer actually moves are ever in a new place.
with numbered as (
  select mc.move_id,
         mc.category_id,
         (row_number() over (
           partition by mc.category_id
           order by m.updated_at desc, mc.move_id
         ) - 1)::int as pos
    from public.move_categories mc
    join public.moves m on m.id = mc.move_id
)
update public.move_categories mc
   set position = n.pos
  from numbered n
 where mc.move_id = n.move_id
   and mc.category_id = n.category_id
   and mc.position = 0
   and n.pos <> 0;
