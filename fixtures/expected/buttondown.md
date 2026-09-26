Welcome back from summer break. This issue is being assembled item by item in WT Builder.

_[Read this issue online](https://weekly.thingelstad.com/archive/350/) · [Listen to it](https://weekly.thingelstad.com/podcast/)_

---

## Currently

**Building:** A focused tool for creating The Weekly Thing.

**Listening:** Brandi Carlile.

---

![Golden sunset over a calm lake with a silhouetted tree line and water tower.](https://files.thingelstad.com/weekly-thing/349/cover.jpg)

Beautiful evening with the sun coming down.

_May 16, 2026 · [Cannon Lake, Warsaw, MN](https://www.openstreetmap.org/?mlat=44.25538&mlon=-93.35226#map=16/44.25538/-93.35226)_

---

## Notable

### [Create Your Own Currency With Flipcash](https://avc.xyz/create-your-own-currency-with-flipcash)

Community currencies remain an interesting design space.

### [LLMs are functions, not brains.](https://james-pritchard.com/blog/llms-are-functions)

---

## Minnesota Technology Council

I had my first official meeting of the Technology Advisory Council. I am looking forward to helping in established areas like cloud and data transformation, as well as new areas with AI deployment.

---

## Journal

### Saturday

[10:54 AM](https://www.thingelstad.com/2026/05/16/mazie-and-i-taking-the.html) — Mazie and I taking the boat out for the season. Beautiful day!

[5:25 PM](https://www.thingelstad.com/2026/05/16/first-visit-to-pleasant-grove.html) — First visit to Pleasant Grove Pizza Farm for 2026! Delicious pizza.

### Sunday

[10:15 PM](https://www.thingelstad.com/2026/05/17/fabulous-show-by-the-new.html) — Fabulous show by The New Standards at The Dakota tonight.

<img src="https://www.thingelstad.com/uploads/2026/dakota.jpg" alt="The New Standards on stage at The Dakota">

---

## Briefly

Interesting project if you want to try running your own models. → **[forge: A framework for self-hosted LLM workflows](https://github.com/antoinezambelli/forge)**

A good demonstration of what token speed feels like. → **[tokenspeed](https://mikeveerman.github.io/tokenspeed)**

This should be a built-in feature in Shortcuts. → **[Introducing Shortcuts Playground](https://www.macstories.net/stories/introducing-shortcuts-playground/)**

---

<div class="from-thingy" style="margin:0 0 1.6em;padding:14px 18px;border-left:3px solid #2f7d4f;background:#f5f8f6;border-radius:0 8px 8px 0;font-family:Georgia,'Source Serif 4','Times New Roman',serif;color:#1a1a1a">
<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#5f6b63;margin:0 0 8px"><a href="https://thingy.thingelstad.com" style="color:#2f7d4f;text-decoration:none;font-weight:600">From Thingy</a>, my agentic librarian</p>
{% if subscriber.subscriber_type == 'premium' %}
<p>Supporting Members make the Weekly Thing possible while directing every membership dollar to this year's nonprofit partner. Thank you for being one.</p>
{% else %}
<p>Supporting Members make the Weekly Thing possible while directing every membership dollar to this year's nonprofit partner.</p>
<p style="text-align:center; padding:10px 0; font-size: 16px; font-weight: bold;">
<buttondown-button href="https://weekly.thingelstad.com/members/?email={{ subscriber.email | urlencode }}&ref=WT350">Become a Supporting Member</buttondown-button>
</p>
{% endif %}
</div>

---

Time to head outside. I hope you have a wonderful weekend.

---

P.S. If you are reading this in your inbox, you are reading the only edition that carries it. Reply and tell me what you are building.

---

**Summer pages turn  
Each item finds its own place  
Old echoes return**

---

## Echoes

<div class="from-thingy" style="margin:0 0 1.6em;padding:14px 18px;border-left:3px solid #2f7d4f;background:#f5f8f6;border-radius:0 8px 8px 0;font-family:Georgia,'Source Serif 4','Times New Roman',serif;color:#1a1a1a">
<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#5f6b63;margin:0 0 8px"><a href="https://thingy.thingelstad.com" style="color:#2f7d4f;text-decoration:none;font-weight:600">From Thingy</a>, my agentic librarian</p>
<p>This week's return to building recalls earlier issues about owning the tools that shape your work, most directly <a href="https://weekly.thingelstad.com/archive/349/" target="_blank" rel="noreferrer">WT349</a>.</p><p><em>Ask Thingy:</em> <a href="https://thingy.thingelstad.com/chat/?prompt=How+has+Jamie%27s+thinking+about+building+his+own+tools+changed%3F&amp;from=weekly-thing-350" target="_blank" rel="noreferrer">How has Jamie&#39;s thinking about building his own tools changed?</a></p>
<p>Shortcuts has been the workflow behind this newsletter since <a href="https://weekly.thingelstad.com/archive/210/" target="_blank" rel="noreferrer">WT210</a>; this issue is the first assembled without it.</p>
</div>

{% if medium == 'email' %}
<img src="https://tinylytics.app/pixel/a2YQr3ZMqkySNYSwz4uF.gif?path=/email/350/" alt="tinylytics" style="width:1px;height:1px;border:0;" />
{% endif %}

<!--
The email edition is the website edition plus subscriber branching, not a
different document. What differs here:

- ps-1 renders. It is email-only (channels: email true, website false, audio
  false) and exists to prove per-channel inclusion end to end.
- "Read this issue online · Listen to it" sits under the intro: the page, and
  the episode once the podcast has been sent (the podcast page before).
- The regular-subscriber branch of Membership ends with the button to the
  members page (the year at $48, email prefilled, ref=WT350); the premium
  branch has no button - members are thanked, not re-pitched.
- The Tinylytics open pixel closes the body, anonymous and named for the
  issue, email medium only - as every issue before the builder had it.
- No title in the body and a --- rule between sections, matching the issues
  Jamie sent before the builder (WT349, compared 2026-09-20): the subject
  carries the title and Buttondown prints it.
- Membership is wrapped in Liquid inside Thingy's frame (an inline-styled div
  with the body as HTML, so no mail-side Markdown parser looks inside it). The
  branching is added by this renderer; the item itself carries one body, and
  the frame is outside the branch so
  attribution survives either path.
- Item order and Thingy attribution match the website exactly.
- Journal images carry no width/height: Buttondown's template sizes them,
  and a fixed size overflowed in Mail (WT350).
- Echoes is one frame around every echo, each rendered to HTML as its thread
  and its Ask-Thingy door.
-->
