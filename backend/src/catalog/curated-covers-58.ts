// @ts-nocheck
// ── Pack covers ──────────────────────────────────────────────
//
// Four TMDB poster paths per pack, rendered as a 2x2 generated cover
// (generated-covers.ts: content-addressed, served from our own host, no key).
// Picked from the 2026-10-28 verification fetch: the first poster of each of
// the pack's first folders, in order (language en-US, region GB; a regional
// service uses its own region's fetch). Posters are public image.tmdb.org
// paths; refresh them by re-running the verification and re-picking.

const PACK_COVERS = {
  "discover": ["/rmaNMA1seHqpjtnYKzyynFAr1g8.jpg","/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg","/gO8Fo47KV1opiutRDdBS5jclTQB.jpg"],
  "streaming": ["/iISM36voS1E8gX9BM0DVK0kgi3E.jpg","/iOb2fjXLbpJgyQXe46n1WtGCnaa.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg"],
  "franchises": ["/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/8GFtkImmK0K1VaUChR0n9O61CFU.jpg","/fai0rspsNeJCS69wHNjOdWxcI7P.jpg","/wuMc08IPKEatf9rnMNXvIDxqP4W.jpg"],
  "genres": ["/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/1BdZbNvl1SfrrX8J9X5tQzN6Ivu.jpg","/9l1NuFjel2j89hiuiJbsxfblqjy.jpg","/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg"],
  "studios": ["/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/qJ2tW6WMUDux911r6m7haRef0WH.jpg","/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg","/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg"],
  "themes": ["/s0m4TM1XRAftQStgKpw024RvkJo.jpg","/wcrjc1uwQaqoqtqi67Su4VCOYo0.jpg","/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg","/7DmtuAK5gYGlMFA45Oxkl1bEpIC.jpg"],
  "actors": ["/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg","/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg","/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg","/pThyQovXQrw2m0s9x82twj48Jq4.jpg"],
  "preset-just-added": ["/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/onSD9UXfJwrMXWhq7UY7hGF2S1h.jpg","/fgSm5ylwiXbIHn8UbUXDjk9RRu4.jpg","/1N4o5PmmqhlVDrcdJ2RlCFWbLGX.jpg"],
  "preset-family-night": ["/7YiB8tOQcY8ApdKkCnjQL5jGkIP.jpg","/snFM00mpNAfUzUtkdEW0uDEvXA0.jpg","/fvsSEJXkUV2tIh6kuCVk2icfFYw.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg"],
  "preset-hidden-gems": ["/360qdtu2hLnqMu8SVHMywn420w1.jpg","/zhG3vKWyDRaZYoaww1UVAi29T9h.jpg","/3sgnSfNT27Bx5O5ukr7B26mhEQq.jpg","/nFmg2G4IJ0x9mALXkYFN8Gw0Dw5.jpg"],
  "preset-documentaries": ["/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg","/fAyZqyN78VYb0usFgsmYjxZIFcN.jpg","/tfgccePxnswMqhmtxafliLlcCVR.jpg","/cbxiZ1l21KUATu2KKQQ8J8fJhpe.jpg"],
  "preset-weekend-binge": ["/rmaNMA1seHqpjtnYKzyynFAr1g8.jpg","/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/9l1NuFjel2j89hiuiJbsxfblqjy.jpg","/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg"],
  "preset-cinema-now": ["/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/fgSm5ylwiXbIHn8UbUXDjk9RRu4.jpg","/9l1NuFjel2j89hiuiJbsxfblqjy.jpg","/1BdZbNvl1SfrrX8J9X5tQzN6Ivu.jpg"],
  "preset-tv-binge": ["/onSD9UXfJwrMXWhq7UY7hGF2S1h.jpg","/h6Z2oogE4mJk2uffdtIlLhb0EHx.jpg","/1N4o5PmmqhlVDrcdJ2RlCFWbLGX.jpg","/sJZcy8QsOPuRPiCfoCWVB3r9Ohg.jpg"],
  "preset-action-rush": ["/jSn3jOzI91dOx4aVdfMrirWXH6R.jpg","/d4bIOaZOH8sqjB3RLMUP96B7WgZ.jpg","/1MhI8NzLkdB3CR9gwA7e2gB2rGC.jpg","/sC7f8OwfmQ8a5GeTUeQAAwRodGO.jpg"],
  "preset-comedy-fix": ["/97p3pggh0KQIAOYsclhp2e0GxLh.jpg","/wRPgZUWMZ8fFszfduEPdKa4Mmwm.jpg","/gHa5V7A23CLntW4PwqKeDu66Smf.jpg","/aKPxBMJo1o3NNDetVDkvExbRlMC.jpg"],
  "preset-horror-night": ["/r10fSbmxDipJG6VOyt9nkX3zEbx.jpg","/uGGpnWHOmWTARVN9wbC1nPxNgps.jpg","/sGV1iNinY0hkeHEwKhOxLzaxT3Z.jpg","/8ZtH1V4rhrtP53ezlEWrCaMALXF.jpg"],
  "preset-scifi-worlds": ["/rtmmvqkIC5zDMEd638Es2woxbz8.jpg","/r2J02Z2OpNTctfOSN1Ydgii51I3.jpg","/qzMYKnT4MG1d0gnhwytr4cKhUvS.jpg","/uPyLsKl8Z0LOoxeaFXsY5MxhR5s.jpg"],
  "preset-mystery-thriller": ["/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/fgSm5ylwiXbIHn8UbUXDjk9RRu4.jpg","/wcrjc1uwQaqoqtqi67Su4VCOYo0.jpg","/hJNdizFlxOW89edX3Rzr6OliSFI.jpg"],
  "preset-romance-night": ["/7bvInsosAsfSaiwQmPXUJA2kZz1.jpg","/hwZ0Ck06YljXHis39mI0xyiMMmk.jpg","/dF1P8wT9cDcgNMfgngiYj4oR7qG.jpg","/oJPTeLoSVGSHo7sJIhgEBVlByMH.jpg"],
  "preset-fantasy-adventure": ["/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg","/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/1BdZbNvl1SfrrX8J9X5tQzN6Ivu.jpg","/hJNdizFlxOW89edX3Rzr6OliSFI.jpg"],
  "preset-crime-files": ["/2Y2lb1vAA2accn5sK3E87rflnpg.jpg","/dB6Krk806zeqd0YNp2ngQ9zXteH.jpg","/kwbctsShSn0Q5QoKc4AU2NIguDN.jpg","/6YmeO4pB7XTh8P8F960O1uA14JO.jpg"],
  "preset-animation-station": ["/7YiB8tOQcY8ApdKkCnjQL5jGkIP.jpg","/sfQtVlIHljToOwYjhe21KPGzZWK.jpg","/yrArRw51BQMIy1y1z3w1XURA7V7.jpg","/6Ryitt95xrO8KXuqRGm1fUuNwqF.jpg"],
  "preset-true-stories": ["/eI0QW02PYqhnmIvLRdn9vrfVVP7.jpg","/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg","/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg","/lmrulvLbmaejTix1YaMxo1oGhH1.jpg"],
  "preset-quick-watches": ["/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg","/5fu2d809jepLwEpES7wggiECLoQ.jpg","/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg","/mV8SDTjkxrDxu0a0egvFz1lRPU7.jpg"],
  "preset-retro-rewind": ["/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/plcZXvI310FkbwIptvd6rqk63LP.jpg","/fZXSwgZknp81vmciTb86rw0MejV.jpg","/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg"],
  "preset-modern-classics": ["/kIa9CyK2yiE4CAy7RJPGe7lztse.jpg","/kOVEVeg59E0wsnXmF9nrh6OmWII.jpg","/zhG3vKWyDRaZYoaww1UVAi29T9h.jpg","/momkKuWburNTqKBF6ez7rvhYVhE.jpg"],
  "preset-prestige-tv": ["/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg","/wa3ZQE9kLnqwN3vQ0NNjg1NPsCa.jpg","/anFx9aTOOYqgS3v7x3R84Kz67ly.jpg","/pbpoLLp4kvnYVfnEGiEhagpJuVZ.jpg"],
  "preset-streaming-top-ten": ["/chZa8Jd9kSDj11bekGjwwotFPEw.jpg","/AnJ8IQJI23hNpYXVNaythu061Ru.jpg","/gaet1xQ2nxrG0V1Ep9T20ZMNEIC.jpg","/q1epO0eO8DWu8Vo8tPfvVlzW48T.jpg"],
  "preset-free-streaming": ["/f1sxYpzsLLMnX1p5mpUKbPRBXt2.jpg","/8j58iEBw9pOXFD2L0nt0ZXeHviB.jpg","/rLNSOudrayDBo1uqXjrhxcjODIC.jpg","/602vevIURmpDfzbnv5Ubi6wIkQm.jpg"],
  "preset-superhero-universe": ["/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/8GFtkImmK0K1VaUChR0n9O61CFU.jpg","/qQclTgLMDvGBuUBFGHRipxkEwWR.jpg","/5UsK3grJvtQrtzEgqNlDljJW96w.jpg"],
  "preset-epic-marathons": ["/fai0rspsNeJCS69wHNjOdWxcI7P.jpg","/6oom5QYQ2yQTMJIbnvbkBL9cHo6.jpg","/l5uxY5m5OInWpcExIpKG6AR3rgL.jpg","/nNAeTmF4CtdSgMDplXTDPOpYzsX.jpg"],
  "preset-holiday-comfort": ["/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/fhHB1uvfFKKFbj6bTKE8xdtsjKi.jpg","/5O616X9vmRzQdB68PHzBewPittd.jpg","/6m0F7fsXjQvUbCZrPWcJNrjvIui.jpg"],
  "preset-directors": ["/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg","/AnJ8IQJI23hNpYXVNaythu061Ru.jpg","/vQWk5YBFWF4bZaofAbv0tShwBvQ.jpg","/nrmXQ0zcZUL8jFLrakWc90IR8z9.jpg"],
  "preset-decades": ["/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/6Ryitt95xrO8KXuqRGm1fUuNwqF.jpg","/hV9T358eS17C4m4ORPrl8VqyHwf.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg"],
  "preset-world-cinema": ["/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg","/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/vNvHT0v9xt7dDTqYue2fWXePKi7.jpg","/bxB2q91nKYp8JNzqE7t7TWBVupB.jpg"],
  "preset-latest-streaming": ["/mab5wPeGVjbMyYMzyzfdKKnG9cl.jpg","/5xmXVd7nCK3tAo34XkO58SxUCip.jpg","/x3HEvYXWOW6WHqsHmg2MUVy3SLm.jpg","/n29MsV1m2OCbDp6PLeHxziOVOLG.jpg"],
  "preset-top-rated": ["/d4bIOaZOH8sqjB3RLMUP96B7WgZ.jpg","/zTOVRp1yp9Jm2BgeIWLYVDdIdd0.jpg","/wRThHSul9H7BXdpIUWMM5hy32YR.jpg","/2cfwAq9nTDqQOuQLL1jPdUYWH1Y.jpg"],
  "preset-studio-spotlight": ["/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg","/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg","/sfQtVlIHljToOwYjhe21KPGzZWK.jpg","/bRwnj8WEKBCvmfeUNOukJPwB43K.jpg"],
  "lelibrary-special": ["/rmaNMA1seHqpjtnYKzyynFAr1g8.jpg","/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg","/gO8Fo47KV1opiutRDdBS5jclTQB.jpg"],
  "streaming-region": ["/iISM36voS1E8gX9BM0DVK0kgi3E.jpg","/iOb2fjXLbpJgyQXe46n1WtGCnaa.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/aHhHRz6nOpwkqJs5ASeRGAdK2dt.jpg"],
  "seasonal": ["/ogwQOLbCfncjvBhFb5l0OmQH8KC.jpg","/f5f3TEVst1nHHyqgn7Z3tlwnBIH.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/saHP97rTPS5eLmrLQEcANmKrsFl.jpg"],
  "kids-family": ["/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/fRBfkzSrcyrnUfVgpEtTurEEiac.jpg","/myd1K3gefdNAWFsGNRDdMeiK9Qg.jpg"],
  "world-tv": ["/sPdS6oUdXfBNGKROE5RY5s5laqx.jpg","/2DIBDFHiKQawz4WPsYekl9DHwyA.jpg","/3jlaQYWWZgmLQMIsQ7uZid99Mlo.jpg","/4aZ2P5crezp0Kl4E4VUJQRO362T.jpg"],
  "anime-hub": ["/9ZN1P32SHviL3SV51qLivxycvcx.jpg","/AojgldgsOlzZV8ahyOzaiAjJWvV.jpg","/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg","/gLKOYIMyKlUHW0SVdskhgf9C0yy.jpg"],
  "shared-universes": ["/78lPtwv72eTNqFW9COBYI0dWDJa.jpg","/8GFtkImmK0K1VaUChR0n9O61CFU.jpg","/fai0rspsNeJCS69wHNjOdWxcI7P.jpg","/wuMc08IPKEatf9rnMNXvIDxqP4W.jpg"],
  "cinephile": ["/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg","/pyIDpB5iZMRB5PdV9an146QEXAl.jpg","/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg","/czsyPHosFNbh4PPqXfqWu1aBXnA.jpg"],
  "moods": ["/s0m4TM1XRAftQStgKpw024RvkJo.jpg","/wcrjc1uwQaqoqtqi67Su4VCOYo0.jpg","/wfuqMlaExcoYiUEvKfVpUTt1v4u.jpg","/ogwQOLbCfncjvBhFb5l0OmQH8KC.jpg"],
  "based-on": ["/iOb2fjXLbpJgyQXe46n1WtGCnaa.jpg","/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/eI0QW02PYqhnmIvLRdn9vrfVVP7.jpg","/i7UyjfPio0VFHB9rBUZSFyhOoM8.jpg"],
  "history-war": ["/vNvHT0v9xt7dDTqYue2fWXePKi7.jpg","/eI0QW02PYqhnmIvLRdn9vrfVVP7.jpg","/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg","/saHP97rTPS5eLmrLQEcANmKrsFl.jpg"],
  "sports-music": ["/9PXZIUsSDh4alB80jheWX4fhZmy.jpg","/kIBMvdZ3qLUycHLbT6IFs7UtaCq.jpg","/kTf9kJ3QMQqYs6wNdYJeVtwIZ2Z.jpg","/wfuqMlaExcoYiUEvKfVpUTt1v4u.jpg"],
  "charts": ["/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg","/iISM36voS1E8gX9BM0DVK0kgi3E.jpg","/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg","/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg"],
  "persona-starter": ["/rmaNMA1seHqpjtnYKzyynFAr1g8.jpg","/6VY1ZKgpsc8CfGsQcCGiYEgHdH0.jpg","/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg","/gO8Fo47KV1opiutRDdBS5jclTQB.jpg"],
  "persona-cinephile": ["/Ap8QwmKfSjYbWC4XIP8w9pdn72O.jpg","/pyIDpB5iZMRB5PdV9an146QEXAl.jpg","/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg","/czsyPHosFNbh4PPqXfqWu1aBXnA.jpg"],
  "persona-family": ["/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/fRBfkzSrcyrnUfVgpEtTurEEiac.jpg","/myd1K3gefdNAWFsGNRDdMeiK9Qg.jpg"],
  "persona-anime": ["/9ZN1P32SHviL3SV51qLivxycvcx.jpg","/AojgldgsOlzZV8ahyOzaiAjJWvV.jpg","/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg","/v3JuB15WybKmxDeT1hWdK3j6eSJ.jpg"],
  "persona-horror": ["/1BdZbNvl1SfrrX8J9X5tQzN6Ivu.jpg","/4tTrW9dXCByS5wt2pXVWb58zNjz.jpg","/rhGx6E3qRNMgj3i5su2oukNHwIQ.jpg","/cpf7vsRZ0MYRQcnLWteD5jK9ymT.jpg"],
  "persona-binge": ["/iISM36voS1E8gX9BM0DVK0kgi3E.jpg","/iOb2fjXLbpJgyQXe46n1WtGCnaa.jpg","/oQffRNjK8e19rF7xVYEN8ew0j7b.jpg","/aHhHRz6nOpwkqJs5ASeRGAdK2dt.jpg"],
};

export interface CuratedCovers58Api {
  PACK_COVERS: Record<string, string[]>;
}

module.exports = { PACK_COVERS } satisfies CuratedCovers58Api;
