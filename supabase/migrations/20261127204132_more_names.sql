-- Longer name lists for new kids. Traditional New England names sit beside the original seed.
-- Yankee and Puritan given names, Irish New England, Franco mill towns, and the Portuguese coast.
-- Kids already created keep the names they have. A new wave draws from the whole list.

insert into private.given_names (name, sex) values
  ('ABEL', 'M'), ('ALBERT', 'M'), ('AMOS', 'M'), ('ARTHUR', 'M'),
  ('ASA', 'M'), ('CALEB', 'M'), ('CHESTER', 'M'), ('CYRUS', 'M'),
  ('EBENEZER', 'M'), ('EDWARD', 'M'), ('ELIAS', 'M'), ('ELMER', 'M'),
  ('ETHAN', 'M'), ('EVERETT', 'M'), ('FRANCIS', 'M'), ('GEORGE', 'M'),
  ('GIDEON', 'M'), ('HAROLD', 'M'), ('HENRY', 'M'), ('HOMER', 'M'),
  ('HORACE', 'M'), ('ISAAC', 'M'), ('JACOB', 'M'), ('JAMES', 'M'),
  ('JEDEDIAH', 'M'), ('JOHN', 'M'), ('JOSEPH', 'M'), ('JOSIAH', 'M'),
  ('JUDAH', 'M'), ('LEMUEL', 'M'), ('LEVI', 'M'), ('LUTHER', 'M'),
  ('MALACHI', 'M'), ('MICAH', 'M'), ('MOSES', 'M'), ('NATHAN', 'M'),
  ('OBADIAH', 'M'), ('PATRICK', 'M'), ('PHINEAS', 'M'), ('RALPH', 'M'),
  ('REUBEN', 'M'), ('ROGER', 'M'), ('RUFUS', 'M'), ('SEAN', 'M'),
  ('SETH', 'M'), ('SILAS', 'M'), ('SIMEON', 'M'), ('THADDEUS', 'M'),
  ('TOBIAS', 'M'), ('WALTER', 'M'), ('WILBUR', 'M'), ('ABIGAIL', 'F'),
  ('AGNES', 'F'), ('ALICE', 'F'), ('ANNE', 'F'), ('BEATRICE', 'F'),
  ('BRIDGET', 'F'), ('CECILE', 'F'), ('CHARITY', 'F'), ('CLARA', 'F'),
  ('CONSTANCE', 'F'), ('DOROTHY', 'F'), ('EDITH', 'F'), ('EILEEN', 'F'),
  ('ELEANOR', 'F'), ('ELIZA', 'F'), ('EMILY', 'F'), ('ESTHER', 'F'),
  ('EUNICE', 'F'), ('FAITH', 'F'), ('FLORENCE', 'F'), ('GRACE', 'F'),
  ('HANNAH', 'F'), ('HARRIET', 'F'), ('HELEN', 'F'), ('HEPZIBAH', 'F'),
  ('HOPE', 'F'), ('JANE', 'F'), ('JOANNA', 'F'), ('KATHLEEN', 'F'),
  ('LOUISA', 'F'), ('LUCY', 'F'), ('LYDIA', 'F'), ('MARGARET', 'F'),
  ('MARIE', 'F'), ('MARTHA', 'F'), ('MARY', 'F'), ('MATILDA', 'F'),
  ('MAUREEN', 'F'), ('MERCY', 'F'), ('OLIVE', 'F'), ('PATIENCE', 'F'),
  ('PHOEBE', 'F'), ('POLLY', 'F'), ('PRISCILLA', 'F'), ('PRUDENCE', 'F'),
  ('REBECCA', 'F'), ('SARAH', 'F'), ('SUSAN', 'F'), ('TABITHA', 'F'),
  ('THERESE', 'F'), ('VIRGINIA', 'F'), ('WINIFRED', 'F');

insert into private.family_names (name) values
  ('ADAMS'), ('ALDEN'), ('ALLEN'), ('AMES'),
  ('APPLETON'), ('AVERY'), ('BARTLETT'), ('BENNETT'),
  ('BRADFORD'), ('BRADSTREET'), ('BRENNAN'), ('BREWSTER'),
  ('BRIGGS'), ('BROWN'), ('BUNKER'), ('BURKE'),
  ('BYRNE'), ('CABOT'), ('CALLAHAN'), ('CARVER'),
  ('CHANDLER'), ('CHASE'), ('CLARK'), ('COBB'),
  ('COFFIN'), ('COLBY'), ('CONANT'), ('CONNOLLY'),
  ('CONNOR'), ('COOLIDGE'), ('CORREIA'), ('CROSBY'),
  ('CROWNINSHIELD'), ('CROWLEY'), ('CUSHING'), ('DANE'),
  ('DAVIS'), ('DEXTER'), ('DONOVAN'), ('DOYLE'),
  ('DUDLEY'), ('DYER'), ('EATON'), ('EMERSON'),
  ('ENDICOTT'), ('FAIRBANKS'), ('FARIA'), ('FITZGERALD'),
  ('FLANAGAN'), ('FLINT'), ('FLYNN'), ('FONTAINE'),
  ('FOSTER'), ('FRENCH'), ('FROST'), ('FULLER'),
  ('GAGNON'), ('GALE'), ('GALLAGHER'), ('GAUTHIER'),
  ('GOODWIN'), ('GOULD'), ('GRANT'), ('HALE'),
  ('HALL'), ('HANCOCK'), ('HASKELL'), ('HAWTHORNE'),
  ('HENNESSY'), ('HILL'), ('HINCKLEY'), ('HOOKER'),
  ('HOPKINS'), ('HOWE'), ('HOWARD'), ('HUNT'),
  ('KEEFE'), ('KELLEY'), ('KENNEDY'), ('KENT'),
  ('KING'), ('LAVOIE'), ('LINCOLN'), ('LOWELL'),
  ('LYMAN'), ('MACY'), ('MALONE'), ('MARSH'),
  ('MATHER'), ('MAYHEW'), ('MCCARTHY'), ('MEDEIROS'),
  ('MERRILL'), ('MILLER'), ('MOORE'), ('MORSE'),
  ('MURPHY'), ('NOYES'), ('OSGOOD'), ('PAINE'),
  ('PALMER'), ('PARKER'), ('PARSONS'), ('PEABODY'),
  ('PECK'), ('PERKINS'), ('PERRY'), ('PHIPPS'),
  ('PICKERING'), ('PIERCE'), ('PIKE'), ('PORTER'),
  ('PRATT'), ('PRESCOTT'), ('PUTNAM'), ('QUINCY'),
  ('RICHARDSON'), ('RIORDAN'), ('ROGERS'), ('ROY'),
  ('RUSSELL'), ('SALTONSTALL'), ('SAWYER'), ('SEARS'),
  ('SHEA'), ('SILVEIRA'), ('SMITH'), ('SNOW'),
  ('SOUZA'), ('STANDISH'), ('STODDARD'), ('STONE'),
  ('SULLIVAN'), ('THAYER'), ('THIBAULT'), ('TROTTIER'),
  ('TURNER'), ('TUTTLE'), ('WALKER'), ('WARREN'),
  ('WEBSTER'), ('WELLS'), ('WHEELER'), ('WHIPPLE'),
  ('WHITE'), ('WHITNEY'), ('WHITTIER'), ('WINTHROP'),
  ('WOOD'), ('YOUNG'), ('BELANGER'), ('BLANCHARD'),
  ('BOUCHER'), ('COTE'), ('O''BRIEN'), ('O''CONNOR'),
  ('O''MALLEY'), ('PELLETIER');

insert into private.nicknames (name) values
  ('ABBY'), ('ADDIE'), ('BETTY'), ('BINNIE'),
  ('BUB'), ('BUCK'), ('BUCKY'), ('CARRIE'),
  ('CHARLIE'), ('CHET'), ('CY'), ('DAN'),
  ('DEACON'), ('DEKE'), ('DOLLY'), ('EBB'),
  ('EFFIE'), ('HATTIE'), ('HETTY'), ('IKE'),
  ('JAKE'), ('JED'), ('JOE'), ('JOSIE'),
  ('KITTY'), ('LEFTY'), ('LIBBY'), ('LIZZIE'),
  ('MAGGIE'), ('MAMIE'), ('MIKE'), ('MILLIE'),
  ('MINNIE'), ('MOLLY'), ('NELL'), ('NELLIE'),
  ('NETTIE'), ('PAT'), ('PETE'), ('RUBE'),
  ('SADIE'), ('SALLY'), ('SI'), ('SIS'),
  ('STUB'), ('TED'), ('TILLIE'), ('TOM'),
  ('WHITEY'), ('WILL'), ('WINNIE'), ('ZEKE');

comment on table private.given_names is
  'Curated given names for generated kids, including traditional New England names. Not exposed to the API.';

comment on table private.family_names is
  'Curated family names for generated kids, including traditional New England names. Not exposed to the API.';

comment on table private.nicknames is
  'Short nicknames, including New England diminutives. About 8 percent of kids get one.';

do $check$
begin
  if (select count(*) from private.given_names) <> 193
    or (select count(*) from private.family_names) <> 238
    or (select count(*) from private.nicknames) <> 88
    or (select count(*) from private.given_names where sex = 'M') <> 101
    or (select count(*) from private.given_names where sex = 'F') <> 92
  then
    raise exception 'THE NAME LIST DID NOT GROW';
  end if;
  if not exists (select 1 from private.given_names where name = 'MAYA' and sex = 'F')
    or not exists (select 1 from private.family_names where name = 'CHEN')
    or not exists (select 1 from private.nicknames where name = 'ACE')
    or not exists (select 1 from private.given_names where name = 'JOSIAH' and sex = 'M')
    or not exists (select 1 from private.given_names where name = 'PATIENCE' and sex = 'F')
    or not exists (select 1 from private.family_names where name = 'O''BRIEN')
    or not exists (select 1 from private.family_names where name = 'PEABODY')
    or not exists (select 1 from private.nicknames where name = 'HATTIE')
  then
    raise exception 'A NAMED ROW IS MISSING';
  end if;
  if exists (
    select 1 from private.given_names
    where name !~ '^[A-Z][A-Z''-]{0,23}$' or sex not in ('M', 'F')
  ) or exists (
    select 1 from private.family_names
    where name !~ '^[A-Z][A-Z''-]{0,23}$'
  ) or exists (
    select 1 from private.nicknames
    where name !~ '^[A-Z][A-Z''-]{0,23}$'
  ) then
    raise exception 'A NAME DOES NOT FIT';
  end if;
end;
$check$;
