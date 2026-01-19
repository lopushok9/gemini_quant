import { type IAgentRuntime, type Media, ModelType } from '@elizaos/core';

/**
 * Represents media data containing a buffer of data and the media type.
 */
export type MediaData = {
  data: Buffer;
  mediaType: string;
};

/**
 * Fetches media data from a list of attachments, supporting both HTTP URLs and local file paths.
 *
 * @param attachments - Array of Media objects containing URLs or file paths to fetch media from
 * @returns Promise that resolves with an array of MediaData objects containing the fetched media data and content type
 */
export async function fetchMediaData(attachments: Media[]): Promise<MediaData[]> {
  return Promise.all(
    attachments.map(async (attachment: Media) => {
      // Check if URL starts with http or https
      if (attachment.url.startsWith('http://') || attachment.url.startsWith('https://')) {
        // Fetch from URL
        const response = await fetch(attachment.url);
        const mediaBuffer = Buffer.from(await response.arrayBuffer());
        const mediaType = attachment.contentType || 'image/png';
        return { data: mediaBuffer, mediaType };
      }

      // Local file paths are currently commented out - can be enabled if needed
      //   const mediaBuffer = await fs.promises.readFile(path.resolve(attachment.url));
      //   const mediaType = attachment.contentType || 'image/png';
      //   return { data: mediaBuffer, mediaType };

      throw new Error('Local file paths are not supported yet');
    })
  );
}

/**
 * Processes attachments by generating descriptions for supported media types.
 * Supports images and PDFs with automatic description generation using LLM.
 *
 * @param attachments - Array of attachments to process
 * @param runtime - Agent runtime for LLM access
 * @returns Returns a new array of processed attachments with added description, title, and text properties
 */
export async function processAttachments(
  attachments: Media[],
  runtime: IAgentRuntime
): Promise<Media[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  runtime.logger.debug(`[Bootstrap] Processing ${attachments.length} attachment(s)`);

  const processedAttachments: Media[] = [];

  for (const attachment of attachments) {
    // Only process supported media types
    if (attachment.contentType?.startsWith('image/') || attachment.contentType?.startsWith('application/pdf')) {
      const processedAttachment: Media = { ...attachment };

      // Only process if description doesn't exist
      if (!processedAttachment.description) {
        try {
          let base64Data = '';
          let mimeType = attachment.contentType;

          // Only convert local/internal media to base64
          if (!attachment.url.startsWith('http://') && !attachment.url.startsWith('https://')) {
            // For local files, we'd need to read and convert
            // Currently this is not implemented
            runtime.logger.debug('[Bootstrap] Skipping local file processing:', attachment.url);
            processedAttachments.push(attachment);
            continue;
          } else {
            // For external URLs, fetch and convert
            const response = await fetch(attachment.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            base64Data = buffer.toString('base64');
            mimeType = attachment.contentType || response.headers.get('content-type') || 'image/png';
          }

          // Generate description using multimodal LLM
          const descriptionPrompt = `Describe this ${mimeType.startsWith('image/') ? 'image' : 'document'} in detail. Include:
1. What you see in the content
2. Any text visible in the content
3. The overall context and purpose
4. Any notable details or important information

Be concise but thorough.`;

          const description = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt: descriptionPrompt,
            attachments: [
              {
                ...attachment,
                data: base64Data,
                contentType: mimeType,
              },
            ],
          });

          processedAttachment.description = description;
          processedAttachment.title = attachment.title || `${mimeType} attachment`;
          processedAttachment.text = description; // Store description as text for easy access

          runtime.logger.debug(
            `[Bootstrap] Generated description for attachment: ${attachment.url}`
          );
        } catch (error) {
          runtime.logger.error(
            `[Bootstrap] Error processing attachment: ${attachment.url} - ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      processedAttachments.push(processedAttachment);
    } else {
      // Non-supported media types pass through unchanged
      processedAttachments.push(attachment);
    }
  }

  return processedAttachments;
}

