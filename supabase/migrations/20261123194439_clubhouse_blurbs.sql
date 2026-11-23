-- Shelf flavor says what the item does for the team. Costs stay on the card, not in this line.

update public.clubhouse_items as item
set blurb = next.blurb
from (
  values
    ('extra_baseballs', 'A SPARE BALL STAYS IN THE BAG SO PLAY DOES NOT STOP FOR A LOST ONE.'),
    ('ice_pops', 'THE KIDS HOLD THEIR STAMINA THROUGH THE HEAT.'),
    ('borrowed_gloves', 'THE FIELDERS GET A SURE HAND ON THE BALL.'),
    ('tarp_and_chalk', 'WET DIRT DOES NOT SWALLOW THE HOPS OR THE LINES.'),
    ('metal_bat', 'ONE LINEUP SPOT GETS A LITTLE MORE POP.')
) as next(id, blurb)
where item.id = next.id;
