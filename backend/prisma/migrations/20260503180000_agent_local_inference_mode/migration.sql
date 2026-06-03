-- When runtime is "local", stores whether the user chose on-device models (e.g. Ollama) or cloud API models.
ALTER TABLE "agents" ADD COLUMN "local_inference_mode" TEXT;
