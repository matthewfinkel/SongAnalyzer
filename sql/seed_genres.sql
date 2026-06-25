-- Fixed genre tag vocabulary. These rows are always present.
-- Run via: database.py _init_schema or `python main.py init-db`
CREATE TABLE IF NOT EXISTS genre_tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

INSERT OR IGNORE INTO genre_tags (name) VALUES ('Alternative');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Ambient');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Blues');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Classical');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Country');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Disco');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Drum & Bass');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Dubstep');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('EDM');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Electronic');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Emo');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Folk');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Funk');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Gospel');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Grunge');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Hardcore');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Hip-Hop');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('House');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Indie');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Jazz');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Latin');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Metal');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('New Wave');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Opera');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Pop');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Post-Rock');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Progressive');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Psychedelic');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Punk');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('R&B');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Reggae');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Rock');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Singer-Songwriter');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Ska');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Soul');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Synth-Pop');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Techno');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Trance');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('Trap');
INSERT OR IGNORE INTO genre_tags (name) VALUES ('World');
