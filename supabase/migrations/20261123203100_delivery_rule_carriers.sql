alter table public.delivery_rules add column dispatch_carrier text
  check (dispatch_carrier is null or (
    kind <> 'enquiry' and dispatch_carrier = btrim(dispatch_carrier)
    and length(dispatch_carrier) between 1 and 100 and dispatch_carrier !~ '[[:cntrl:]]'
  ));
