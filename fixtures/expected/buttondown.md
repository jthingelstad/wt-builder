# The Weekly Thing 350

This fixture intentionally resembles the website edition but permits
Buttondown-specific Liquid, components, and subscriber branching.

The real renderer must preserve the item order and Thingy attribution while
producing valid Buttondown source.

{% if subscriber.subscriber_type == 'premium' %}

_A membership thank-you written by Thingy._

{% else %}

_A membership invitation written by Thingy._

{% endif %}

## Echoes

_By Thingy_

This section is always last.
