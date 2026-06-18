/* curated.js — Curated Wikipedia content: Poems, Biographies,
   Speeches, Major Events. Each entry is just a Wikipedia link;
   summary + full article are fetched the same way as everywhere
   else in the app (no separate content store needed).          */

const CuratedContent = {

  poems: [
    { wikiLink: "https://en.wikipedia.org/wiki/If%E2%80%94" },
    { wikiLink: "https://en.wikipedia.org/wiki/The_Road_Not_Taken" },
    { wikiLink: "https://en.wikipedia.org/wiki/Invictus" },
    { wikiLink: "https://en.wikipedia.org/wiki/The_Charge_of_the_Light_Brigade" },
    { wikiLink: "https://en.wikipedia.org/wiki/Do_Not_Go_Gentle_into_That_Good_Night" },
  ],

  biographies: [
    { wikiLink: "https://en.wikipedia.org/wiki/Marie_Curie" },
    { wikiLink: "https://en.wikipedia.org/wiki/Mahatma_Gandhi" },
    { wikiLink: "https://en.wikipedia.org/wiki/Albert_Einstein" },
    { wikiLink: "https://en.wikipedia.org/wiki/Nelson_Mandela" },
    { wikiLink: "https://en.wikipedia.org/wiki/Ada_Lovelace" },
  ],

  speeches: [
    { wikiLink: "https://en.wikipedia.org/wiki/I_Have_a_Dream" },
    { wikiLink: "https://en.wikipedia.org/wiki/Gettysburg_Address" },
    { wikiLink: "https://en.wikipedia.org/wiki/We_Shall_Fight_on_the_Beaches" },
    { wikiLink: "https://en.wikipedia.org/wiki/Tryst_with_Destiny" },
    { wikiLink: "https://en.wikipedia.org/wiki/Quit_India_Movement" },
  ],

  majorEvents: [
    { wikiLink: "https://en.wikipedia.org/wiki/Apollo_11" },
    { wikiLink: "https://en.wikipedia.org/wiki/Fall_of_the_Berlin_Wall" },
    { wikiLink: "https://en.wikipedia.org/wiki/Indian_independence_movement" },
    { wikiLink: "https://en.wikipedia.org/wiki/Wright_brothers" },
    { wikiLink: "https://en.wikipedia.org/wiki/Discovery_of_penicillin" },
  ],

};
