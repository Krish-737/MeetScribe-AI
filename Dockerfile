# Use the official Microsoft Playwright image (Python pre-installed)
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PORT=8000

# Set the working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Expose port and start backend
EXPOSE $PORT
CMD uvicorn backend.main:app --host 0.0.0.0 --port $PORT
