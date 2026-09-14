const { z } = require("zod");

exports.analyzeMealSchema = z.object({
  body: z
    .object({
      imageBase64: z.string().optional(),
      image: z.string().optional(),
    })
    .refine((data) => data.imageBase64 || data.image, {
      message: "Image base64 data is required (as imageBase64 or image field)",
    }),
});
