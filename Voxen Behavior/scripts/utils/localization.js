export function sendLocalizedMessage(
    player,
    key,
    values = []
) {
    const rawtext = {
        translate: key
    };

    if (values.length > 0) {
        rawtext.with = {
            rawtext: values.map(
                value =>
                    value &&
                    typeof value === "object" &&
                    ("text" in value || "translate" in value)
                        ? value
                        : ({
                            text: String(value)
                        })
            )
        };
    }

    player.sendMessage({
        rawtext: [
            rawtext
        ]
    });
}
