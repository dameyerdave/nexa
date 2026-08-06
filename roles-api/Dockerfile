FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Collectstatic only needs settings to import cleanly, not real secrets/DB -
# config/settings.py has a safe placeholder SECRET_KEY for exactly this.
RUN python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py bootstrap && gunicorn config.wsgi:application --bind 0.0.0.0:8000"]
