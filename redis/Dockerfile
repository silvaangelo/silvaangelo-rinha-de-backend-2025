FROM redis:7.2-alpine
COPY ./redis/redis.conf /usr/local/etc/redis/redis.conf
COPY ./redis/init-redis.sh /init-redis.sh

RUN set -x \
  && chmod u+x /init-redis.sh

ENTRYPOINT ["/init-redis.sh"]